/**
 * Drizzle DB 클라이언트 팩토리. (web 서버 등에서 import해 사용)
 */
import { drizzle } from "drizzle-orm/postgres-js";
import postgres from "postgres";
import * as schema from "./schema.js";

export type Db = ReturnType<typeof makeDb>;

/**
 * Supabase Postgres 연결.
 * 트랜잭션 풀러(6543)를 쓰면 prepared statement 미지원 → prepare:false 필수.
 */
export function makeDb(url: string) {
  const client = postgres(url, { prepare: false });
  return drizzle(client, { schema });
}
