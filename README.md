# decku

웹/모바일 브라우저에서 **내 Mac에 떠 있는 Claude Desktop 세션**을 보고 조종한다. 로그인 없이 **QR 페어링**, 본문은 **E2EE**(서버·벤더가 못 읽음), 자체 상시 서버 0(무료 tier).

**라이브**: 웹 **[decku.app](https://decku.app)** · CLI **[`@decku/cli`](https://www.npmjs.com/package/@decku/cli)**(npm) · 문서 [/docs](https://decku.app/docs) · [/faq](https://decku.app/faq)

```bash
npx @decku/cli          # 설치 없이 한 줄 — 첫 실행 시 자동 페어링(QR) 후 watch+중계
```

> 공식 Remote Control·Happy는 *새로 시작한* CLI 세션만 다룬다. decku는 **이미 떠 있는 Claude Desktop 세션 전체**를 `~/.claude`에서 읽어 나열한다 — 그게 차별점.

## 구조

```
[내 Mac] ~/.claude ──watch──▶ 브릿지(로컬 Node)
                                │  암호화 publish / cmd subscribe
                                ▼
                       Supabase Realtime (ciphertext 중계만)
                                ▲
[브라우저] ◀── SvelteKit(Vercel) + 토큰 API ─┘
```

- `apps/bridge` — 각 Mac의 로컬 CLI(`@decku/cli`, bin `decku`). 세션 스캔 + transcript tail → 암호화 publish, `cmd` 받으면 `claude --resume`로 주입. **서브커맨드 없이 `decku`** 한 줄이면 필요 시 자동 페어링 후 watch.
- `apps/web` — SvelteKit. 랜딩 + `/docs`·`/faq` + 토큰 발급 API(`/api/pair`, `/api/realtime-token`). Vercel(decku.app) 배포.
- `apps/db` — `@decku/db` Drizzle 스키마 툴(선택적 namespace 폐기용).
- `packages/shared` — 채널명·enc-cwd·jsonl 파서·메시지 스키마·E2EE 봉투.

격리: 채널 `tenant:<namespace>:*` + Supabase RLS(`topic namespace == JWT claim`). namespace는 추측 불가 랜덤. E2EE 키는 페어링 QR의 `#fragment`에만(서버 미전송).

보안 강화(0.1.5+): **cmd anti-replay**(send에 ts·nonce, 봉투 내부 → 재전송 거부) · **구독자-게이트 heartbeat**(보는 사람 있을 때만 publish — presence + watch-ping 폴백) · **페어링 만료 opt-in**(`--expire-days`, 기본 무제한).

## 로컬 실행

```bash
pnpm install

# 1) 웹앱 (.env 필요 — 아래 환경변수)
bin/run-web                            # = pnpm --filter web dev (포트 5173/5174)

# 2) 브릿지: 로컬 dev 서버로 페어링 + watch (한 줄)
pnpm --filter @decku/cli dev --url http://localhost:5173
```
`decku`(위 명령)가 출력한 QR/URL을 브라우저에서 열면 세션 목록·대화가 뜨고, 입력창으로 채팅을 보낼 수 있다. 첫 실행 시 자동 페어링되며, 이후엔 `~/.decku/config.json`에 저장돼 재사용된다.

### 환경변수

`apps/web/.env` ([예시](apps/web/.env.example)):
```
SUPABASE_JWT_SECRET=     # 🔒 Supabase → Settings → API → Legacy JWT Secret (HS256)
PUBLIC_SUPABASE_URL=
PUBLIC_SUPABASE_ANON_KEY=
```
`apps/db/.env` (스키마 마이그레이션 시): `DATABASE_URL=` (Supabase **Session pooler 5432**, direct는 IPv6라 불가).

> Supabase 신규 프로젝트는 ECC 서명키가 기본이라 우리가 직접 서명 못 함 → **Legacy JWT Secret(HS256)** 을 쓰고 Revoke 금지.

### Supabase 셋업 (1회)

```bash
pnpm --filter @decku/db apply-rls        # RLS 격리 정책(supabase/migrations/0001)
pnpm db:migrate                          # namespaces 테이블
```

## 배포 (M5)

### 웹 → Vercel
1. Vercel에 repo 연결, **Root Directory = `apps/web`** (pnpm workspace 자동 감지).
2. 환경변수 3개(`SUPABASE_JWT_SECRET`, `PUBLIC_SUPABASE_URL`, `PUBLIC_SUPABASE_ANON_KEY`) 등록.
3. 커스텀 도메인(`decku.app`) 연결됨. 사용자는 `decku` 한 줄로 시작(기본 URL = `https://decku.app`).

### 브릿지 → npm / npx
```bash
cd apps/bridge
npm version patch --no-git-tag-version      # 버전 올림 (prepublishOnly가 tsup 빌드)
# 글로벌 ~/.npmrc 토큰은 2FA bypass 없어 E403 → .env의 granular 토큰으로:
set -a && . ./.env && set +a
NPMRC=$(mktemp); printf '//registry.npmjs.org/:_authToken=%s\n' "$NPM_TOKEN" > "$NPMRC"
npm publish --userconfig "$NPMRC"; rm -f "$NPMRC"
```
사용자: `npx @decku/cli` 한 줄 (처음엔 자동 페어링 → QR → watch+중계).
부팅 자동시작(macOS): 전역 설치 후 `decku` 한 번 실행해 페어링 → `decku install`(launchd). Windows=작업 스케줄러, Linux=systemd user에 `decku run` 등록.

## 보안 체크리스트

- [x] `SUPABASE_JWT_SECRET`은 웹 서버 env에만. 브라우저/브릿지엔 단명 realtime JWT만. service_role 미사용.
- [x] 토큰 capability `tenant:<namespace>:*` — RLS로 강제(교차 namespace 거부 실측).
- [x] namespace 144bit 랜덤, realtime JWT 1h. e2eeKey는 QR `#fragment`에만 → Supabase는 ciphertext만(실측).
- [x] 전송(쓰기)도 본인 namespace만(RLS insert).
- [x] backfill 청크 분할(40 events/chunk)로 메시지 크기 한도 회피.
- [x] enc-cwd 치환·죽은 pid 거르기 회귀 테스트.
- [x] **cmd anti-replay**: send에 ts·nonce(봉투 내부) → 오래되거나 중복된 주입 거부(`ReplayGuard`).
- [x] **구독자-게이트 heartbeat**: 보는 사람 없으면 publish 정지 → Supabase 메시지/월 급감(presence + watch-ping 폴백).
- [x] **페어링 만료(opt-in)**: `--expire-days N` → stateless 서명 토큰(`purpose=decku-pairing`)으로 발급 게이트. 기본 무제한.
- [ ] (후순위) `/api/pair`·`/api/realtime-token` rate limit + Supabase 동시연결/메시지 쿼터 설정, `namespaces.revoked` 확인으로 기기 폐기, 프로덕션 RLS 적용 점검.

자세한 로드맵·결정 근거는 [PLAN.md](PLAN.md).
