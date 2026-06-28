# @decku/db — Drizzle 스키마 관리 툴

DB 스키마의 **단일 진실원천**은 [`src/schema.ts`](src/schema.ts). 코드를 바꾸고 커맨드로 DB에 반영한다.

## 스키마 업데이트 루프 (Claude가 따르는 절차)

스키마를 바꿔야 할 때:

1. **`src/schema.ts` 수정** — 테이블/컬럼 추가·변경.
2. **마이그레이션 생성**: `pnpm db:generate`
   → `drizzle/` 에 변경분 SQL + 메타 저널 생성 (DB 연결 불필요, 커밋 대상).
3. **DB에 적용**: `pnpm db:migrate`  (DATABASE_URL 필요)
   - 빠른 개발 반영만 필요하면 `pnpm db:push` (마이그레이션 파일 없이 직접 sync).

> 즉 **"schema.ts 편집 → `db:generate` → `db:migrate`"** 가 표준 루프. Claude는 스키마를 바꿀 때 이 순서를 자동으로 수행한다.

## 커맨드 (루트에서)

| 커맨드 | 하는 일 | DB 연결 |
|---|---|---|
| `pnpm db:generate` | schema diff → `drizzle/*.sql` 마이그레이션 | ❌ |
| `pnpm db:migrate` | `drizzle/` 마이그레이션 적용 | ✅ |
| `pnpm db:push` | 스키마를 DB에 직접 sync (개발용) | ✅ |
| `pnpm db:studio` | Drizzle Studio (브라우저 GUI) | ✅ |

## 설정

`apps/db/.env` 에 `DATABASE_URL` (Supabase → Settings → Database → Connection string, **Transaction pooler 6543** 권장). `.env.example` 참고. gitignore됨.

## 범위

- Drizzle은 **우리 소유 테이블(public)** 만 관리 (`schemaFilter: ["public"]`).
- Supabase Realtime의 RLS 정책은 우리 테이블이 아니므로 여기 아님 → [`supabase/migrations/0001_realtime_authorization.sql`](../../supabase/migrations/0001_realtime_authorization.sql) 로 따로 적용.
