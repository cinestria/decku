# decku — 구현 계획 (멀티테넌트 / Supabase)

> 토대 설계: [claude-desktop-webapp-design.md](claude-desktop-webapp-design.md)
> 결정: **처음부터 멀티테넌트**, realtime/auth/DB 벤더는 **Supabase**.
> 작성일 2026-06-28.

## 0. 한 줄 요약

각 유저 Mac의 로컬 **브릿지**가 `~/.claude/`를 watch → **Supabase Realtime(Broadcast)** 로 델타 publish, 브라우저가 subscribe해서 세션 목록/대화 렌더. 채팅 전송은 브라우저 → `cmd` 채널 → 브릿지가 `claude --resume`(Agent SDK)로 주입. 테넌트 격리는 **채널 네임스페이스 + Realtime Authorization(RLS)** 로 강제. 자체 상시 서버 0.

## 1. 기술 스택

| 덩이 | 기술 | 비고 |
|---|---|---|
| 브릿지 | Node 20+ (TS), `@anthropic-ai/claude-agent-sdk`, `@supabase/supabase-js`, `chokidar` | 로컬 데몬. **npm 패키지 + `npx`** 배포(1-B). 서브커맨드 CLI |
| 프론트 | **SvelteKit** + `@sveltejs/adapter-vercel` | 정적/SSR + `+server.ts` 엔드포인트. `@supabase/ssr` |
| 토큰 API | SvelteKit `+server.ts` (Vercel serverless) | 단명 scoped JWT 발급. **JWT secret은 서버 env에만** |
| Realtime | Supabase Realtime **Broadcast** (private channels) | relay. 영속 저장 안 함 |
| Auth/DB | Supabase Auth + Postgres + **RLS** | users/devices/pairings |

모노레포 (pnpm workspaces):
```
decku/
  apps/
    web/            # SvelteKit (프론트 + /api 토큰 +server.ts)
    bridge/         # 로컬 Node 데몬 (CLI)
    db/             # @decku/db — Drizzle 스키마 관리 툴 (generate/migrate/push)
  packages/
    shared/         # 채널명 규칙, 메시지 타입, jsonl 파서, enc-cwd 변환
  supabase/         # migrations, RLS policies
  PLAN.md
```
`packages/shared`에 둘 양쪽 공유 로직:
- `encCwd(cwd)` — `/`·`.` → `-`
- 채널명 빌더: `sessionsChannel(uid)`, `txChannel(uid, sid)`, `cmdChannel(uid)`
- 메시지 스키마 (zod): 세션목록 항목, transcript 이벤트, cmd `{sessionId, text}`
- jsonl 라인 파서 (`user`/`assistant`/`attachment`/`ai-title` → 렌더 모델)

## 1-A. E2EE (서버·벤더가 내용을 못 읽음 — 증명의 핵심)

"서버에 대화/세션을 저장하지 않음"을 **약속이 아니라 구조로** 보장한다.

- 브릿지가 transcript/세션 페이로드(본문·cwd·세션제목 포함)를 **유저 전용 키로 암호화** → Supabase는 ciphertext만 중계. 우리 서버·Supabase 모두 평문을 받지 않음.
- 암호: 페이로드는 대칭키(AES-GCM, libsodium/WebCrypto)로 암호화. 유저별 **마스터 시크릿**에서 파생.
- **키 교환은 페어링에 얹는다** (4-A 참조). 마스터 시크릿은 서버로 절대 전송 안 함.
- **남는 신뢰 = 클라이언트 정직성**(브릿지·브라우저가 키를 안 빼돌리는가). → 오픈소스 대신 **후순위 서드파티 보안 감사**로 보강 (M6).
- 한계: 메타데이터(채널명=userId, 타이밍, 메시지 크기)는 암호화 안 됨. 민감 본문은 전부 페이로드에 넣어 암호화로 가린다.

## 1-B. 브릿지 배포 (npm/npx 1순위)

언어는 **Node/TS 확정** — 전송이 Claude Agent SDK(JS 생태계)이고, `claude` CLI(Claude Desktop이 설치)가 어차피 로컬에 필요하므로 Node 의존은 추가 부담이 아님.

- **1순위: npm 패키지 `@decku/bridge` + `npx`.** 한 코드베이스로 Mac/Win/Linux, 설치 없이 최신 실행, `npm publish` 한 줄. brew/scoop/winget은 이걸 감싸는 얇은 래퍼(M5).
- **CLI는 서브커맨드 구조**로 설계:
  - `pair <code>` — 페어링 코드 제출 → device token 수령·로컬 저장
  - `run` — watch + realtime 데몬 (기본)
  - `install` / `uninstall` — OS별 autostart 등록 (launchd / Task Scheduler / systemd user)
- 후순위(M6+, 수요 확인 후): Node 없는 유저용 단일 바이너리(bun/SEA, 서명·공증) 또는 Tauri 트레이 앱(같은 Node 브릿지를 sidecar로 재사용).

## 2. 채널 / 격리 설계

```
tenant:<userId>:sessions        브릿지 → 브라우저  (세션 목록 델타)
tenant:<userId>:tx:<sessionId>  브릿지 → 브라우저  (transcript append/backfill 청크)
tenant:<userId>:cmd             브라우저 → 브릿지  (채팅 전송)
```
- 전부 Supabase **private** broadcast 채널.
- **Realtime Authorization**: `realtime.messages`에 RLS 정책. JWT의 `sub`(user_id)와 채널 topic의 `<userId>`가 일치할 때만 read/write 허용. → 토큰이 자기 `tenant:<uid>:*` 밖을 못 봄.
- 메시지 크기 한도(청크) → backfill은 줄/청크 분할 publish + `seq`/`done` 플래그.

## 3. 데이터 모델 (Supabase)

**초기(QR 페어링): DB 거의 0.** namespace+pairingJWT는 stateless 서명 토큰이라 테이블 불필요. transcript·세션목록·E2EE키는 어디에도 저장 안 함(realtime + 로컬 파일 + QR이 source of truth).

**스키마는 Drizzle(`@decku/db`)로 관리** — `apps/db/src/schema.ts` 수정 → `pnpm db:generate` → `pnpm db:migrate`. (Realtime RLS는 우리 테이블이 아니라 별도 raw SQL.)

```ts
// apps/db/src/schema.ts (현재)
namespaces : id(=namespace) PK, created_at, revoked, label   -- 선택적 revoke용

// M6 로그인 추가 시 여기에 users/devices 추가 → generate → migrate
```

## 4. 인증 / 페어링 흐름

**초기 = QR 페어링, 로그인 0** (Happy 방식). Google/Apple 로그인은 "영속 계정·다기기·폐기"가 필요해질 때의 **후순위 업그레이드**(M6).

### 4-A. QR 페어링 (로그인 없이 격리 + E2EE)
```
[브릿지] 첫 실행 (decku pair)
  → POST /api/pair  → { namespace(랜덤), pairingJWT(단명, namespace 서명) } 수령
  → e2eeKey(32B) 로컬 생성 — 서버에 절대 안 보냄
  → 로컬 저장(~/.decku/) + QR 표시 { namespace, pairingJWT, e2eeKey }  (또는 deep-link URL)
[브라우저] QR 스캔 / URL 열기
  → e2eeKey 를 로컬(IndexedDB)에 저장
  → pairingJWT 로 POST /api/realtime-token → tenant:<namespace>:* scoped 토큰
[브릿지] 이후: pairingJWT(또는 device token) 으로 같은 엔드포인트에서 realtime 토큰 갱신
```
- **테넌트 = 랜덤 namespace.** 계정 없이 격리: namespace는 추측 불가 + 토큰이 그 namespace만 허용 → 목표 3 충족.
- **E2EE 키는 QR에만** — 서버·Supabase 모두 본문 못 봄(§1-A와 합쳐짐).
- **시크릿이 곧 자격증명** — QR 새면 그 namespace 노출. 초기엔 서버측 revoke 없음(트레이드오프). 폐기·다기기는 M6 로그인에서.

### 4-B. 토큰 발급 (서버리스, DB 거의 0)
- Supabase Realtime은 **자체 서명 JWT**(namespace를 claim으로, Supabase JWT secret으로 서명)로 Authorization → **Supabase Auth 안 거침**.
- RLS: `realtime.messages`에서 `realtime.topic()`의 namespace == JWT claim 일 때만 read/write.
- **JWT secret은 Vercel env에만.** 브라우저/브릿지엔 단명 scoped JWT만. 초기엔 users/devices 테이블 불필요(stateless JWT).

### 4-C. 후순위: Google/Apple 로그인 (M6)
- 영속 계정·다기기 동기화·기기 폐기가 필요해지면 추가.
- Google: Cloud OAuth 클라이언트 ID + 동의화면(심사 불필요, 비용 0).
- Apple: **Developer Program $99/yr** + Services ID·.p8 + client_secret JWT **6개월 로테이션**.

## 5. 종단간 전송 경로

```
브라우저 입력 → cmd publish {sessionId, text}
  → 브릿지 cmd subscribe 수신
  → Agent SDK: claude -p --resume <sessionId> --output-format stream-json --input-format stream-json 로 text 주입
  → 세션 처리 → transcript jsonl append
  → 브릿지 watch가 append 감지 (byte offset 추적, 새 바이트만)
  → tx:<sessionId> 로 publish
  → 브라우저 렌더 갱신
```
⚠ 함정: jsonl에 직접 써서 전송 불가(queue-operation은 로그). 반드시 Agent SDK resume. 모는 세션은 "브릿지가 resume해 띄운 세션"(같은 sessionId/transcript 공유).

## 6. 마일스톤 (수용 기준 포함)

멀티테넌트로 가지만 **브릿지 읽기 → realtime → 전송 → 인증/배포** 순으로 위험을 앞에서 깬다.

### M0 — 스캐폴딩 ✅ 완료
- pnpm 모노레포, `packages/shared`(encCwd·채널명·세션/메시지 zod 스키마·jsonl 파서 + 24 유닛테스트), bridge 골격(tsx).
- ✅ 전체 테스트 24/24 통과, 타입체크 통과. 실제 `~/.claude/projects/.../*.jsonl` smoke 테스트 포함.

### M1 — 브릿지 읽기부분 ✅ 완료
- `apps/bridge`: `lib/sessions.ts`(스캔+`kill(pid,0)` live 필터+enc-cwd 경로), `lib/tail.ts`(byte-offset tail, 멀티바이트/부분줄/truncate 안전), `lib/render.ts`(콘솔), `run` 커맨드(폴링으로 새/종료 세션 감지 + 멀티세션 tail, `[sessionId]`·`--from-start`).
- ✅ 실측: live 세션 3개 목록 + 실시간 append(자기 Bash tool_use) 콘솔 출력 확인. tail 유닛테스트 6개 통과. 데스크탑 안 건드림(파일 read만).

### M2 — Supabase Realtime + RLS + 토큰 route (QR 페어링, 로그인 0) ✅ 완료
- `apps/web`: SvelteKit + `/api/pair`(namespace+pairingJWT) + `/api/realtime-token`(자체 서명 JWT). jwt-core(HS256) + 토큰 테스트 5개. Vercel 빌드 OK.
- Realtime Authorization RLS(`supabase/migrations/0001`): `topic namespace == JWT claim`. `apply-rls` 스크립트로 적용. `namespaces` 테이블 `db:migrate`로 생성.
- ✅ **실측 격리 통과**: nsA 토큰 → `tenant:nsA` SUBSCRIBED, `tenant:nsB` Unauthorized(RLS 거부). **레거시 HS256 토큰을 Realtime이 검증함**(third-party JWT 불필요).

### M2.5 — E2EE 봉투 ✅ 완료 (키교환 배선은 M3)
- `packages/shared/crypto.ts`: AES-256-GCM(WebCrypto) `encrypt`/`decrypt` + 키 `generate/import` + QR용 `encodeKey/decodeKey`(base64url). 브릿지(Node)·브라우저 공용.
- ✅ 유닛테스트 8개: 왕복·ciphertext 노출 없음·다른 키 거부·GCM 위변조 거부·iv 매번 다름·키 길이 검증.
- 다음(M3): 페어링 QR에 e2eeKey 동봉 + publish 전 encrypt / 수신 후 decrypt 배선.

### M3 — realtime 읽기 왕복 (QR 페어링, 암호화) ✅ 완료
- 브릿지: `pair`(=/api/pair → namespace+token, e2eeKey 생성, QR/URL) + `run` realtime(세션목록 heartbeat publish, cmd load 백필 청크, live append) — 전부 E2EE 봉투.
- 프론트: pairing(URL hash→localStorage) + `DeckuClient`(구독/복호/cmd) + 세션목록·대화 UI(Svelte 5).
- ✅ **E2E 실측 PASS**: 브릿지→Supabase(ciphertext)→구독자 복호 왕복. 백필 789 events(done), 세션목록 5개, Supabase엔 ciphertext만.

### M4 — 채팅 전송 ✅ 완료
- 브릿지 `lib/inject.ts`: cmd send → `claude -p <text> --resume <sid>`(세션 cwd)로 한 턴 주입. 응답 append는 tail이 tx로 publish.
- 웹: 대화 패널 입력창/전송 → `DeckuClient.sendChat` → cmd send.
- ✅ resume 주입 실측: 같은 transcript에 append + **맥락 유지**(10→18줄, PONG 회상), 같은 sessionId.
- 참고: `-p` 세션은 registry 미등록 → decku 목록엔 Desktop/interactive 세션만. 브라우저 실시간 데모는 실세션에서(주입은 사용자 선택).

### M5 — 배포 준비 ✅ 완료 (최종 publish/deploy는 사용자 계정 단계)
- 브릿지 **tsup 번들**(shared 인라인) → `dist/cli.js`(shebang), `npx @decku/bridge` 단독 동작 확인. bin/files/publishConfig 정리.
- `install`/`uninstall`: macOS **launchd** autostart.
- 루트/브릿지/웹 **README**(Vercel 배포·npx·Supabase 셋업) + 보안 체크리스트 점검.
- ⏭ 사용자 단계: Vercel 배포(env 3개) + `npm publish`(npm 로그인). 그 후 프로덕션 URL로 페어링하면 전 흐름 동작.

### M6 — 보강 (후순위)
- **Google/Apple 로그인 추가**(영속 계정·다기기·기기 폐기). Apple은 $99 결제 후. E2EE **서드파티 보안 감사**. 프라이버시 정책 게시.

## 7. 보안 체크리스트 (출시 게이트)

- [ ] Realtime secret/service key는 **서버·브릿지 env에만**, 브라우저엔 단명 scoped JWT만.
- [ ] 토큰 capability `tenant:<namespace>:*` 로 엄격 제한 — RLS로 강제, 음성 테스트(남의 채널 구독 시도→거부) 포함.
- [ ] namespace는 추측 불가한 길이의 랜덤, pairingJWT 단명. QR 시크릿은 안전 채널로만 전달(노출=namespace 노출). (서버측 폐기·다기기는 M6 로그인.)
- [ ] 전송(쓰기)은 본인 테넌트만. (공유 읽기는 추후 read-only scoped 토큰.)
- [ ] backfill 청크 분할로 메시지 크기 한도 안 넘김.
- [ ] enc-cwd 치환·죽은 pid 거르기 회귀 테스트.
- [ ] **E2EE: e2eeKey가 서버로 절대 전송 안 됨(QR에만, 네트워크 로그로 확인). Supabase 측 페이로드가 ciphertext.**

## 8. 리스크 / 미해결

1. **Agent SDK resume 의미론** — resume한 세션이 GUI 창과 별개 입력 주체. M4에서 실제 동작·중복 입력 충돌 확인 필요(문서 1-4 함의).
2. **Supabase Realtime Authorization** — private 채널 RLS는 비교적 신기능. M2에서 격리 음성 테스트를 반드시 먼저.
3. **메시지 크기/속도 한도** — 무료 tier 한도 내 청크/스로틀. M5 부하 테스트.
4. **브릿지 배포 UX** — 비개발 유저가 로컬 데몬 띄우기. 초기엔 `npx decku` + 페어링 코드 안내로.
5. **E2EE 잔여신뢰** — 오픈소스 안 함 → 클라이언트가 키를 안 빼돌린다는 보장은 코드 비공개 상태. M6 서드파티 감사로 보강. 키 분실 = 복호 불가(설계상 복구 불가, 의도된 것).
6. **Apple 비용/로테이션** — $99/yr + client_secret 6개월 만료. M6에서 결제 후, Supabase 자동 갱신 설정.

## 9. 다음 행동

M0부터 시작 권장. 승인하면 모노레포 스캐폴딩 + `packages/shared`(채널명·enc-cwd·jsonl 파서 + 테스트)부터 만든다.
