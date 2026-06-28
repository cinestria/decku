/**
 * `pnpm --filter @decku/db apply-rls`
 * Supabase Realtime Authorization RLS(raw SQL)를 DB에 적용.
 * Drizzle이 관리하지 않는 realtime.messages 정책이라 별도로.
 */
import "dotenv/config";
import postgres from "postgres";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

const url = process.env.DATABASE_URL;
if (!url) {
  console.error("DATABASE_URL 미설정 (apps/db/.env)");
  process.exit(1);
}

const sqlPath = fileURLToPath(
  new URL("../../../supabase/migrations/0001_realtime_authorization.sql", import.meta.url),
);
const ddl = readFileSync(sqlPath, "utf8");

const client = postgres(url, { max: 1 });
try {
  await client.unsafe(ddl);
  console.log("✓ Realtime RLS 적용 완료");
} finally {
  await client.end();
}
