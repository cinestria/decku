import "dotenv/config";
import { defineConfig } from "drizzle-kit";

const url = process.env.DATABASE_URL;
if (!url) {
  // generate는 DB 없이도 되지만 push/migrate/studio는 필요 → 친절한 에러
  console.warn("⚠ DATABASE_URL 미설정 (apps/db/.env). push/migrate/studio는 동작 안 함.");
}

export default defineConfig({
  dialect: "postgresql",
  schema: "./src/schema.ts",
  out: "./drizzle",
  dbCredentials: { url: url ?? "" },
  // Drizzle은 우리 테이블만 관리 — Supabase 내부 스키마(auth/realtime/storage 등) 건드리지 않게
  schemaFilter: ["public"],
  verbose: true,
  strict: true,
});
