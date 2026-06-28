# Claude Desktop 원격 제어 웹앱 — 설계 문서 (멀티테넌트 / 길 B)

> 핸드오프 문서. 다른 세션/프로젝트에서 이 파일만 읽고 바로 시작할 수 있도록 자기완결적으로 작성.
> 작성일 2026-06-28.

## 0. 목표

웹앱으로 Claude Desktop 세션을 본다/조종한다.

1. 웹앱에 현재 떠 있는 Claude Desktop 세션 목록이 나온다.
2. 세션을 누르면 그 대화 내용이 나오고, 채팅을 치면 그 세션에 전달된다.
3. **여러 사람이 각자 자기 Mac의 Claude Desktop을 연결**한다 (멀티테넌트). 유저A는 유저B 대화를 절대 못 본다.

비용 목표: **무료 tier 안에서**. 자체 상시 서버(Koyeb 등 과금) 없이.

## 1. Claude Desktop이 로컬에 남기는 것 (검증 완료)

설계의 토대. 모두 `~/.claude/` 아래, 실측으로 확인함.

### 1-1. 세션 레지스트리 — `~/.claude/sessions/<pid>.json`
떠 있는 세션마다 한 파일. 예:
```json
{
  "pid": 54252,
  "sessionId": "88b6caad-0aee-4f56-be0a-95c39221c73f",
  "cwd": "/Users/shiregold/Data/Work/vibe-quant",
  "startedAt": 1782661911473,
  "version": "2.1.187",
  "kind": "interactive",
  "entrypoint": "claude-desktop"
}
```
- **세션 목록 = 이 디렉터리의 json들.**
- 라이브 여부 = 그 `pid`가 살아있나 (`process.kill(pid, 0)`).

### 1-2. 대화 transcript — `~/.claude/projects/<enc-cwd>/<sessionId>.jsonl`
- `enc-cwd` = `cwd`의 `/`·`.`를 `-`로 치환한 디렉터리명.
  - 예: `/Users/shiregold/Data/Work/vibe-quant` → `-Users-shiregold-Data-Work-vibe-quant`
- **append-only** JSONL. 한 줄 = 한 이벤트.
- 줄 `type`: `user`, `assistant`, `attachment`, `ai-title`(세션 제목), `last-prompt`, `queue-operation`.
- 대화 렌더 = 이 파일을 파싱해서 `user`/`assistant`/`attachment` 줄을 시간순으로.
- 실시간 = append 감지 후 **새로 붙은 바이트만** 읽기 (byte offset 추적).

### 1-3. 메시지 주입 메커니즘 — `queue-operation`
사용자가 친 메시지는 transcript에 이렇게 들어간다:
```json
{"type":"queue-operation","operation":"enqueue","sessionId":"...","content":"사용자가 친 텍스트"}
```
- 이건 **로그(결과)**다. 파일에 직접 써넣는다고 떠 있는 프로세스가 읽지 않는다 (실제 주입은 pid 대상 내부 IPC, `peerProtocol:1`).
- **따라서 "채팅 전송"은 파일 쓰기로 못 한다.** 전송은 아래 1-4로.

### 1-4. 채팅 전송 = Claude Agent SDK / headless CLI
떠 있는 GUI 세션에 외부에서 메시지를 꽂는 **공식 외부 API는 없다.** 안정적인 길은 브릿지가 세션을 **소유**하는 것:
```bash
claude -p --resume <sessionId> \
  --output-format stream-json --input-format stream-json
```
또는 TS/Python **Claude Agent SDK** (`--resume <sessionId>`)로 세션을 이어 입력을 흘려보냄.
- ⚠ 함의: 이 방식으로 모는 세션은 "GUI 데스크탑 창에 떠 있는 바로 그 세션"이 아니라 **브릿지가 resume해서 띄운 세션**이다. 같은 sessionId/transcript를 공유하지만 입력 주체가 브릿지다. (GUI 창 그 자체를 리모컨하는 건 supported path 없음 → 채택 안 함.)
- 읽기(목록·대화)는 1-1/1-2 파일에서 그대로 되므로, 전송만 SDK로.

## 2. 아키텍처 (길 B — 매니지드 realtime, 자체 서버 0)

```
[유저별 Mac]
  ~/.claude/ ──watch──> 브릿지(로컬 Node)
                          │  publish 델타 / subscribe cmd
                          ▼
                    매니지드 realtime  (Ably 또는 Supabase Realtime)
                          ▲  subscribe / publish
                          │
[브라우저] ◄── 프론트(Vercel 정적 Next.js) + 토큰 API route
```

3덩이:
1. **브릿지** — 각 유저 Mac에서 도는 로컬 Node 프로세스. 파일 watch → realtime publish, `cmd` subscribe → Agent SDK로 전송 실행.
2. **프론트 + 토큰서버** — Vercel. 정적 Next.js 앱 + stateless API route 1개(토큰 발급). 상시 WS 서버 ❌ (Vercel 서버리스라 못 띄움 → realtime은 매니지드로 외주).
3. **매니지드 realtime** — Ably/Supabase. 채널 relay + history(콜드 로드용).

### 왜 자체 상시 서버가 없나
- Vercel은 정적/SSR·짧은 API엔 완벽하나 **상시 WebSocket·인메모리 relay를 못 가짐**.
- 그 relay를 자체 박스(Koyeb 등)에 두면 과금. → 매니지드 pub/sub로 대체해 비용 0.

## 3. 실시간 채널 설계 + 테넌트 격리 (보안 핵심)

채널 이름을 **유저별 네임스페이스**로:
```
tenant:<userId>:sessions          # 세션 목록 (브릿지 → 브라우저)
tenant:<userId>:tx:<sessionId>    # 특정 세션 transcript append
tenant:<userId>:cmd               # 채팅 전송 (브라우저 → 브릿지)
```
- **이 격리가 무너지면 유저 간 대화 전문이 유출된다.** 제품의 보안 경계.
- 발급 토큰은 **capability-scoped**: 로그인한 유저의 `tenant:<userId>:*`만 publish/subscribe 허용. 다른 네임스페이스 접근 토큰 자체가 안 나감.
  - Ably: capability 토큰.
  - Supabase: RLS(row-level security) + Realtime authorization.

### 콜드 초기 로드 (저장소 최소화)
- 세션 목록: realtime **history/retained**로 마지막 메시지 자동 수신 → 별도 KV 불필요.
- 전체 transcript: **on-demand backfill.** 브라우저가 세션을 열 때 `cmd`로 "load `<sessionId>`" → 브릿지가 그 jsonl을 통째로(청크로 쪼개) `tx:<sessionId>`에 publish. 어디에도 transcript를 영속 저장하지 않음.
- ⚠ 매니지드 메시지 크기 한도(Ably ~64KB/msg) → 긴 backfill은 **줄 단위/청크 분할** publish.

## 4. 인증 · 페어링 (멀티테넌트라 필수)

단일 유저면 생략 가능했던 부분. 멀티테넌트라 **DB 필수**(여기서 "저장소 0"이 깨진다).

### 4-1. 유저 로그인
웹앱에 로그인(이메일/OAuth). → `users` 테이블.

### 4-2. 브릿지 ↔ 계정 페어링
남의 Mac 브릿지가 "나는 userX다"를 증명하는 절차:
1. 유저가 웹앱 로그인 → **페어링 코드** 발급(단명, 1회용).
2. 브릿지 실행 시 그 코드 입력(붙여넣기).
3. 브릿지가 코드를 토큰서버에 제출 → 검증되면 **그 테넌트 네임스페이스로 scoped된 device token** 수령, 로컬 저장.
4. 이후 브릿지는 device token으로 realtime 토큰을 갱신.
- device token은 DB(`devices` 테이블)에 저장·폐기 가능(분실 Mac 차단).

### 4-3. 토큰 발급 (Vercel API route)
- `/api/realtime-token`: 로그인 세션(또는 device token) 검증 → **그 유저 네임스페이스만 허용**하는 단명 realtime 토큰 발급.
- **realtime secret 키는 Vercel env에만.** 브라우저에는 절대 안 내려보냄(노출 시 전 채널 구독 가능).
- 브릿지는 device token으로 같은 엔드포인트에서 토큰 수령.

## 5. 데이터 모델 (최소)

```
users     : id, email, created_at
devices   : id, user_id(FK), name, device_token_hash, last_seen, revoked
pairings  : code, user_id(FK), expires_at, used   # 단명 페어링 코드
```
- transcript·세션목록은 **저장 안 함**(realtime + 파일이 source of truth). DB는 ID/페어링/감사 정도만.
- **벤더 추천: Supabase** — auth + Postgres + Realtime + RLS가 한 통, 무료 tier. 멀티테넌트 격리(RLS)가 자연스러움. (Ably는 realtime은 깔끔하나 auth/DB 별도.)

## 6. 전송 경로 (채팅 → 세션) 종단간

```
브라우저 입력
  → tenant:<userId>:cmd 에 publish  {sessionId, text}
  → 브릿지가 cmd subscribe로 수신
  → claude --resume <sessionId> (Agent SDK)로 text 전달
  → 세션이 처리 → transcript jsonl에 append
  → 브릿지 watch가 append 감지 → tenant:<userId>:tx:<sessionId> 에 publish
  → 브라우저 화면 갱신
```

## 7. 비용 / 한도

| 컴포넌트 | 비용 | 비고 |
|---|---|---|
| Vercel | 무료 hobby | 프론트 + 토큰 route |
| Supabase (또는 Ably) | 무료 tier | 소수 유저까진 여유 |
| 브릿지 | 0 | 각 유저 Mac 로컬 |
- 동시접속·메시지·DB row 늘면 유료 tier로. 초기엔 0원.

## 8. 보안 체크리스트

- [ ] realtime **secret 키는 서버(Vercel env)·브릿지에만**, 브라우저엔 단명 scoped 토큰만.
- [ ] 토큰 capability를 **`tenant:<userId>:*`로 엄격 제한** (다른 테넌트 접근 불가).
- [ ] 페어링 코드 단명·1회용, device token 폐기 가능.
- [ ] 대화 전문이 매니지드 벤더를 경유함 → 벤더 신뢰·전송 암호화 확인, 민감 세션 제외 옵션 고려.
- [ ] 전송 권한(채팅)은 본인 테넌트로만. 공유(읽기) 시엔 read-only scoped 토큰 별도.

## 9. 빌드 순서 (권장)

1. **브릿지 읽기부분** (로컬 단독 테스트): `~/.claude/sessions/*.json` 목록 + jsonl tail을 콘솔에 찍기. 데스크탑 안 건드리고 검증.
2. **단일 유저 realtime**: 브릿지 → Ably/Supabase publish, 로컬 프론트가 subscribe해서 목록·대화 렌더. 격리·인증 없이 동작 확인.
3. **전송**: `cmd` 채널 + Agent SDK resume로 채팅 왕복.
4. **인증·페어링·네임스페이스**: 멀티테넌트로 승격. DB·토큰 scoping·페어링 코드.
5. **Vercel 배포**: 프론트 + 토큰 route.

> 1인용으로 1~3 먼저 굴려보고, 수요 확인되면 4~5로 멀티테넌트 승격 권장. (a) "내 세션을 남이 읽기만" 공유가 목적이면 4의 격리는 read-only scoped 토큰 + 공유링크로 훨씬 가볍게 끝남 — 멀티테넌트 전체는 "남이 자기 클로드를 연결"할 때만 필요.

## 10. 핵심 함정 (까먹지 말 것)

- transcript jsonl에 **직접 써서 전송 못 함** → 반드시 Agent SDK resume. (queue-operation은 로그)
- Vercel은 **상시 WS 서버 못 띄움** → realtime은 매니지드 외주.
- 멀티테넌트의 진짜 일 = 신호처리가 아니라 **테넌트 격리 + 페어링 + 토큰 scoping**. 여기 새는 순간 전 대화 유출.
- 매니지드 **메시지 크기 한도** → 긴 transcript backfill 청크 분할.
- `enc-cwd` 치환 규칙(`/`·`.`→`-`)·죽은 pid 거르기(`kill(pid,0)`) 잊지 말 것.
