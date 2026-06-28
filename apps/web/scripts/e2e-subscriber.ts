/**
 * M3 E2E 검증 — "브라우저" 역할(헤드리스). 브릿지 config(~/.decku/config.json)로 페어링을 읽어
 * Supabase에 붙어 세션목록·백필을 복호해 본다. Supabase 측 payload가 ciphertext인지도 확인.
 *
 * 전제: 웹 dev 서버 + `decku-bridge run`(realtime)이 떠 있어야 함.
 * 실행: cd apps/web && pnpm exec tsx scripts/e2e-subscriber.ts
 */
import * as fs from "node:fs";
import * as os from "node:os";
import { createClient, type RealtimeChannel } from "@supabase/supabase-js";
import {
  importKey,
  encrypt,
  decrypt,
  decodeKey,
  sessionsChannel,
  txChannel,
  cmdChannel,
  type EncryptedEnvelope,
  type SessionsPayload,
  type TxPayload,
  type CmdPayload,
  type SessionListItem,
} from "@decku/shared";

const CONFIG_PATH = `${os.homedir()}/.decku/config.json`;
const cfg = JSON.parse(fs.readFileSync(CONFIG_PATH, "utf8")) as {
  apiUrl: string;
  namespace: string;
  pairingToken: string;
  e2eeKey: string;
  supabaseUrl: string;
  supabaseAnonKey: string;
};

const sb = createClient(cfg.supabaseUrl, cfg.supabaseAnonKey, {
  auth: { persistSession: false, autoRefreshToken: false },
});
const key = await importKey(decodeKey(cfg.e2eeKey));
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

async function token(): Promise<string> {
  const r = await fetch(`${cfg.apiUrl}/api/realtime-token`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ pairingToken: cfg.pairingToken }),
  });
  if (!r.ok) throw new Error(`realtime-token ${r.status}`);
  return ((await r.json()) as { token: string }).token;
}

function join(topic: string, onMsg?: (env: EncryptedEnvelope) => void, attempt = 0): Promise<RealtimeChannel> {
  return new Promise((resolve, reject) => {
    const ch = sb.channel(topic, { config: { private: true, broadcast: { self: false } } });
    if (onMsg) ch.on("broadcast", { event: "msg" }, ({ payload }) => onMsg(payload as EncryptedEnvelope));
    ch.subscribe(async (status, err) => {
      if (status === "SUBSCRIBED") resolve(ch);
      else if (status === "CHANNEL_ERROR" || status === "TIMED_OUT") {
        sb.removeChannel(ch);
        if (attempt < 4) {
          await sleep(400 * (attempt + 1));
          resolve(await join(topic, onMsg, attempt + 1));
        } else reject(err ?? new Error(status));
      }
    });
  });
}

await sb.realtime.setAuth(await token());

let sessions: SessionListItem[] = [];
let cipherSample = "";
await join(sessionsChannel(cfg.namespace), async (env) => {
  if (!cipherSample) cipherSample = env.ct.slice(0, 48);
  const p = await decrypt<SessionsPayload>(key, env);
  if (p.type === "sessions") sessions = p.items;
});
const cmdCh = await join(cmdChannel(cfg.namespace));

// 세션 목록 수신 대기 (heartbeat ≤4s)
for (let i = 0; i < 15 && sessions.length === 0; i++) await sleep(500);
console.log(`\n=== M3 E2E ===`);
console.log(`세션 목록 수신: ${sessions.length}개`);
for (const s of sessions) {
  console.log(`  • ${s.title ?? "(제목없음)"}  —  ${s.cwd.split("/").pop()}`);
}
console.log(`Supabase 측 payload(ct) 표본: ${cipherSample || "(없음)"}…  ← 평문 아님(E2EE)`);

if (sessions.length === 0) {
  console.error("✗ 세션 목록 못 받음 (브릿지 run 떠 있나?)");
  process.exit(1);
}

// 가장 먼저 = decku 우선, 아니면 첫 세션 열기
const target = sessions.find((s) => s.cwd.endsWith("/decku")) ?? sessions[0]!;
const txEvents: TxPayload["events"] = [];
let done = false;
await join(txChannel(cfg.namespace, target.sessionId), async (env) => {
  const p = await decrypt<TxPayload>(key, env);
  if (p.type === "tx" && p.sessionId === target.sessionId) {
    txEvents.push(...p.events);
    if (p.done) done = true;
  }
});
// load 요청 (암호화 cmd)
const cmd: CmdPayload = { op: "load", sessionId: target.sessionId };
await cmdCh.send({ type: "broadcast", event: "msg", payload: await encrypt(key, cmd) });

for (let i = 0; i < 20 && !done; i++) await sleep(500);

console.log(`\n세션 열기: ${target.cwd.split("/").pop()}`);
console.log(`백필 수신: ${txEvents.length} events (done=${done})`);
const firstText = txEvents.find((e) => e.kind === "message");
if (firstText && firstText.kind === "message") {
  const t = firstText.blocks.find((b) => b.type === "text");
  if (t && t.type === "text") console.log(`  복호 샘플: "${t.text.slice(0, 60)}…"`);
}

const pass = sessions.length > 0 && txEvents.length > 0 && done;
console.log(`\n${pass ? "✓ PASS — 브릿지→relay→브라우저 E2EE 왕복 동작" : "✗ 확인 필요"}`);
await sb.removeAllChannels();
process.exit(pass ? 0 : 1);
