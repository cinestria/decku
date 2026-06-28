/**
 * `pnpm db:migrate` — drizzle/ 의 마이그레이션을 DB에 적용.
 */
import "dotenv/config";
import { drizzle } from "drizzle-orm/postgres-js";
import { migrate } from "drizzle-orm/postgres-js/migrator";
import postgres from "postgres";

const url = process.env.DATABASE_URL;
if (!url) {
  console.error("DATABASE_URL 미설정 (apps/db/.env)");
  process.exit(1);
}

const client = postgres(url, { max: 1 });
try {
  await migrate(drizzle(client), { migrationsFolder: "./drizzle" });
  console.log("✓ 마이그레이션 적용 완료");
} finally {
  await client.end();
}
