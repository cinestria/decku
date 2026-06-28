# decku

웹/모바일 브라우저에서 **내 Mac에 떠 있는 Claude Desktop 세션**을 보고 조종한다. 로그인 없이 **QR 페어링**, 본문은 **E2EE**(서버·벤더가 못 읽음), 자체 상시 서버 0(무료 tier).

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

- `apps/bridge` — 각 Mac의 로컬 CLI. 세션 스캔 + transcript tail → 암호화 publish, `cmd` 받으면 `claude --resume`로 주입.
- `apps/web` — SvelteKit. 정적 프론트 + 토큰 발급 API(`/api/pair`, `/api/realtime-token`). Vercel 배포.
- `apps/db` — `@decku/db` Drizzle 스키마 툴(선택적 namespace 폐기용).
- `packages/shared` — 채널명·enc-cwd·jsonl 파서·메시지 스키마·E2EE 봉투.

격리: 채널 `tenant:<namespace>:*` + Supabase RLS(`topic namespace == JWT claim`). namespace는 추측 불가 랜덤. E2EE 키는 페어링 QR의 `#fragment`에만(서버 미전송).

## 로컬 실행

```bash
pnpm install

# 1) 웹앱 (.env 필요 — 아래 환경변수)
pnpm --filter @decku/web dev          # 포트 확인(5173/5174)

# 2) 브릿지: 페어링 후 실행
pnpm --filter @decku/bridge exec tsx src/cli.ts pair --url http://localhost:5173
pnpm --filter @decku/bridge exec tsx src/cli.ts run
```
`pair`가 출력한 QR/URL을 브라우저에서 열면 세션 목록·대화가 뜨고, 입력창으로 채팅을 보낼 수 있다.

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
3. 배포 후 프로덕션 URL로 페어링: `decku pair --url https://<your>.vercel.app`.

### 브릿지 → npm / npx
```bash
pnpm --filter @decku/bridge build        # tsup 번들 → dist/cli.js
cd apps/bridge && npm publish            # (npm 로그인 후)
```
사용자: `npx @decku/bridge pair --url <webUrl>` → `npx @decku/bridge run`.
부팅 자동시작(macOS): 전역 설치 후 `decku install`(launchd). Windows=작업 스케줄러, Linux=systemd user에 `decku run` 등록.

## 보안 체크리스트

- [x] `SUPABASE_JWT_SECRET`은 웹 서버 env에만. 브라우저/브릿지엔 단명 realtime JWT만. service_role 미사용.
- [x] 토큰 capability `tenant:<namespace>:*` — RLS로 강제(교차 namespace 거부 실측).
- [x] namespace 144bit 랜덤, realtime JWT 1h. e2eeKey는 QR `#fragment`에만 → Supabase는 ciphertext만(실측).
- [x] 전송(쓰기)도 본인 namespace만(RLS insert).
- [x] backfill 청크 분할(40 events/chunk)로 메시지 크기 한도 회피.
- [x] enc-cwd 치환·죽은 pid 거르기 회귀 테스트.
- [ ] (후순위) `/api/pair`·`/api/realtime-token` rate limit, `namespaces.revoked` 확인으로 기기 폐기, 서드파티 보안 감사.

자세한 로드맵·결정 근거는 [PLAN.md](PLAN.md).
