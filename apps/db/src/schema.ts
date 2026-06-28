/**
 * decku DB 스키마 (Drizzle ORM).
 *
 * 이 파일이 **단일 진실원천(source of truth)**.
 * 스키마 바꾸려면 여기를 수정한 뒤:
 *   pnpm db:generate   # 변경분 → drizzle/ 에 SQL 마이그레이션 생성
 *   pnpm db:migrate    # 그 마이그레이션을 DB에 적용
 * (개발 중 빠른 반영은 pnpm db:push)
 *
 * 주의: Supabase Realtime의 RLS 정책(realtime.messages)은 우리 테이블이 아니라
 * 별도 raw SQL(supabase/migrations/0001_*)로 관리. Drizzle은 우리 소유 테이블만.
 */
import { pgTable, text, boolean, timestamp } from "drizzle-orm/pg-core";

/**
 * QR 페어링 namespace.
 * 초기 stateless 설계에선 없어도 되지만, **서버측 폐기(revoke)** 를 켜려면 이 테이블로
 * realtime-token 발급 전에 revoked 여부를 확인한다. (PLAN §3 / §4-A 트레이드오프)
 */
export const namespaces = pgTable("namespaces", {
  id: text("id").primaryKey(), // = namespace
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  revoked: boolean("revoked").default(false).notNull(),
  label: text("label"), // 선택: 사용자 메모/기기 이름
});
export type Namespace = typeof namespaces.$inferSelect;
export type NewNamespace = typeof namespaces.$inferInsert;

// 향후 로그인(M6) 추가 시 users/devices 테이블을 여기 추가 → db:generate → db:migrate.
