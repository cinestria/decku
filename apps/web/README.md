# @decku/web

decku 프론트 + 토큰 발급 API (SvelteKit, Vercel 배포용).

- `/api/pair` — namespace + pairingToken(HS256) 발급 + 공개 Supabase 값 반환 (로그인 없음)
- `/api/realtime-token` — pairingToken 검증 → namespace scoped 단명 realtime JWT
- `/` — 페어링 수신(URL `#fragment`) → Supabase Realtime 구독 → **복호** → 세션 목록·대화·채팅 입력

환경변수/배포는 루트 [README](../../README.md) 참고. `.env`는 [.env.example](.env.example).

```bash
pnpm --filter @decku/web dev        # 개발
pnpm --filter @decku/web build      # Vercel 빌드
```
