/**
 * M2 격리 음성 테스트 (live Supabase 필요).
 *
 * namespace nsA로 서명한 realtime 토큰으로:
 *  - tenant:nsA:sessions 구독 → SUBSCRIBED 기대 (자기 네임스페이스)
 *  - tenant:nsB:sessions 구독 → CHANNEL_ERROR 기대 (RLS가 거부)
 *
 * 실행: cd apps/web && pnpm exec tsx scripts/iso-test.ts
 */
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { createClient, type RealtimeChannel } from "@supabase/supabase-js";
import { signRealtimeWithSecret } from "../src/lib/server/jwt-core";

// --- .env 로드 (간단 파서) ---
const envText = readFileSync(fileURLToPath(new URL("../.env", import.meta.url)), "utf8");
const env: Record<string, string> = {};
for (const line of envText.split("\n")) {
  if (!line.includes("=") || line.trimStart().startsWith("#")) continue;
  const i = line.indexOf("=");
  env[line.slice(0, i).trim()] = line.slice(i + 1).trim();
}
const URL_ = env.PUBLIC_SUPABASE_URL;
const ANON = env.PUBLIC_SUPABASE_ANON_KEY;
const SECRET = new TextEncoder().encode(env.SUPABASE_JWT_SECRET);
if (!URL_ || !ANON || !env.SUPABASE_JWT_SECRET) {
  console.error("apps/web/.env에 PUBLIC_SUPABASE_URL / PUBLIC_SUPABASE_ANON_KEY / SUPABASE_JWT_SECRET 필요");
  process.exit(1);
}

function subscribeOnce(supabase: ReturnType<typeof createClient>, topic: string): Promise<string> {
  return new Promise((resolve) => {
    let ch: RealtimeChannel;
    const done = (r: string) => {
      try {
        supabase.removeChannel(ch);
      } catch {
        /* noop */
      }
      resolve(r);
    };
    const timer = setTimeout(() => done("TIMEOUT"), 10_000);
    ch = supabase.channel(topic, { config: { private: true } });
    ch.subscribe((status, err) => {
      if (status === "SUBSCRIBED") {
        clearTimeout(timer);
        done("SUBSCRIBED");
      } else if (status === "CHANNEL_ERROR" || status === "TIMED_OUT") {
        clearTimeout(timer);
        done(`${status}${err ? `: ${err.message}` : ""}`);
      }
    });
  });
}

const tokenA = await signRealtimeWithSecret(SECRET, "nsA");
const supabase = createClient(URL_, ANON);
await supabase.realtime.setAuth(tokenA);

const own = await subscribeOnce(supabase, "tenant:nsA:sessions");
const other = await subscribeOnce(supabase, "tenant:nsB:sessions");

console.log("\n=== M2 격리 테스트 ===");
console.log(`  자기 채널 (nsA → tenant:nsA): ${own}`);
console.log(`  남의 채널 (nsA → tenant:nsB): ${other}`);

const pass = own === "SUBSCRIBED" && other.startsWith("CHANNEL_ERROR");
console.log(`\n  ${pass ? "✓ PASS — 격리 동작" : "✗ 확인 필요"}`);
if (own !== "SUBSCRIBED") {
  console.log("    ↳ 자기 채널도 막힘 → HS256 토큰 미검증(레거시 키 문제) 또는 RLS 과도");
}
if (own === "SUBSCRIBED" && !other.startsWith("CHANNEL_ERROR")) {
  console.log("    ↳ 남의 채널이 열림 → RLS 미적용 또는 private 미설정");
}

process.exit(pass ? 0 : 1);
