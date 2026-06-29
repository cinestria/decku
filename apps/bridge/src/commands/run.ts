/**
 * `decku run [sessionId] [--from-start|-a] [--console]`
 *
 * 페어링됨 → **realtime publish 모드**: 세션목록/transcript를 암호화해 Supabase로 publish,
 *            브라우저 cmd(load) 수신.
 * 페어링 안 됨(또는 --console) → 콘솔 모드(M1): 로컬에서 목록+tail만 출력.
 */
import { basename } from "node:path";
import qrcode from "qrcode-terminal";
import type { SessionFile, SessionListItem, TxPayload, CmdPayload, RenderEvent } from "@decku/shared";
import { scanSessions, liveSessions, transcriptPath } from "../lib/sessions.js";
import { TranscriptTail } from "../lib/tail.js";
import { renderEvent } from "../lib/render.js";
import { loadConfig } from "../lib/config.js";
import { createPairing, printPairing } from "./pair.js";
import { BridgeRealtime } from "../lib/realtime.js";
import { injectMessage } from "../lib/inject.js";
import { TitleCache } from "../lib/titles.js";
import { historyList, findTranscript } from "../lib/history.js";

const POLL_MS = 1000;
const HEARTBEAT_MS = 4000; // 늦게 접속한 브라우저도 목록 받도록 주기적 재전송 (broadcast는 replay 없음)
const BACKFILL_CHUNK = 40; // 이벤트/청크 (메시지 크기 한도 회피)
const DIM = "\x1b[2m";
const BOLD = "\x1b[1m";
const RESET = "\x1b[0m";

const shortId = (s: string) => s.slice(0, 8);
const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

function toListItem(s: SessionFile): SessionListItem {
  return {
    sessionId: s.sessionId,
    pid: s.pid,
    cwd: s.cwd,
    ...(s.startedAt !== undefined ? { startedAt: s.startedAt } : {}),
    live: true,
  };
}

export async function run(argv: string[] = []): Promise<void> {
  if (argv.includes("--console")) return runConsole(argv);

  let cfg = await loadConfig();
  if (!cfg) {
    // 첫 실행: 자동으로 페어링한 뒤 그대로 watch+중계로 이어간다 (명령 한 번).
    console.log(`${BOLD}decku${RESET} 첫 실행 — 페어링을 만듭니다.`);
    cfg = await createPairing(argv);
    printPairing(cfg);
    console.log(`${DIM}위 QR/URL을 폰·브라우저에서 한 번 열면 연결됩니다. 그대로 watching…${RESET}`);
  }
  return runRealtime(cfg, argv);
}

// ───────────────────────── realtime 모드 ─────────────────────────

async function runRealtime(cfg: NonNullable<Awaited<ReturnType<typeof loadConfig>>>, argv: string[]): Promise<void> {
  console.log(`${BOLD}decku${RESET} realtime 연결 중… (namespace ${shortId(cfg.namespace)}…)`);
  const rt = new BridgeRealtime(cfg);

  // 브라우저가 연 세션만 live tail (그 외엔 목록만)
  const activeTails = new Map<string, TranscriptTail>();
  const titles = new TitleCache();
  let liveMap = new Map<string, SessionFile>();

  await rt.connect((cmd: CmdPayload) => {
    void handleCmd(cmd).catch((e) => console.error("cmd 처리 실패:", e));
  });

  // 페어링 QR — 폰/웹에서 스캔해 열기 (Claude Remote처럼). namespace는 고정이라 항상 같은 코드.
  const pairUrl = `${cfg.apiUrl}/#ns=${cfg.namespace}&k=${cfg.e2eeKey}`;
  console.log(`\n${BOLD}폰/웹에서 스캔해 열기:${RESET}`);
  qrcode.generate(pairUrl, { small: true });
  console.log(`${DIM}  ${pairUrl}${RESET}\n`);
  console.log(`${DIM}연결됨. watching… (Ctrl-C 종료)${RESET}`);

  async function handleCmd(cmd: CmdPayload): Promise<void> {
    if (cmd.op === "load") {
      const s = liveMap.get(cmd.sessionId);
      // live면 registry 경로, 아니면 과거 transcript에서 탐색
      const path = s ? transcriptPath(s) : (await findTranscript(cmd.sessionId))?.path;
      if (!path) {
        console.log(`${DIM}load: 세션 ${shortId(cmd.sessionId)} 못 찾음${RESET}`);
        return;
      }
      // 전체 백필 (청크 분할)
      const all = await new TranscriptTail(path).init(true);
      const chunks = chunk(all, BACKFILL_CHUNK);
      for (let i = 0; i < chunks.length; i++) {
        const payload: TxPayload = {
          type: "tx",
          sessionId: cmd.sessionId,
          events: chunks[i]!,
          seq: i,
          done: i === chunks.length - 1,
        };
        await rt.publishTx(payload);
      }
      if (chunks.length === 0) {
        await rt.publishTx({ type: "tx", sessionId: cmd.sessionId, events: [], seq: 0, done: true });
      }
      console.log(`${DIM}backfill ${shortId(cmd.sessionId)}: ${all.length} events (${chunks.length} chunks)${RESET}`);
      // live 세션만 이후 append 추적 (과거 세션은 append 없음)
      if (s && !activeTails.has(cmd.sessionId)) {
        const t = new TranscriptTail(path);
        await t.init(false);
        activeTails.set(cmd.sessionId, t);
      }
    } else if (cmd.op === "send") {
      // live면 그 cwd, 아니면 과거 transcript의 cwd로 resume (닫힌 대화 이어가기)
      const s = liveMap.get(cmd.sessionId);
      const found = s ? { cwd: s.cwd, path: transcriptPath(s) } : await findTranscript(cmd.sessionId);
      if (!found) {
        console.log(`${DIM}send: 세션 ${shortId(cmd.sessionId)} 못 찾음${RESET}`);
        return;
      }
      // 응답 append를 tx로 흘리도록 tail 보장
      if (!activeTails.has(cmd.sessionId)) {
        const t = new TranscriptTail(found.path);
        await t.init(false);
        activeTails.set(cmd.sessionId, t);
      }
      const imgN = cmd.images?.length ?? 0;
      console.log(`${DIM}↓ send ${shortId(cmd.sessionId)}: "${cmd.text.slice(0, 40)}"${imgN ? ` (+${imgN} img)` : ""}${RESET}`);
      // 한 턴(응답까지)이라 시간 소요 → fire-and-forget, append는 tail이 publish
      injectMessage(found.cwd, cmd.sessionId, cmd.text, cmd.images)
        .then(() => console.log(`${DIM}  inject 완료 ${shortId(cmd.sessionId)}${RESET}`))
        .catch((e) => console.error(`inject 실패 ${shortId(cmd.sessionId)}:`, (e as Error).message));
    } else if (cmd.op === "history") {
      const items = await historyList(cmd.limit ?? 40);
      await rt.publishHistory({ type: "history", items });
      console.log(`${DIM}↑ history: ${items.length}${RESET}`);
    }
  }

  let stopped = false;
  const stop = () => {
    stopped = true;
  };
  process.on("SIGINT", stop);
  process.on("SIGTERM", stop);

  let lastSessionsJson = "";
  let lastPublish = 0;
  while (!stopped) {
    const live = await liveSessions(await scanSessions());
    liveMap = new Map(live.map((s) => [s.sessionId, s]));

    // 목록 변화 시 또는 heartbeat 주기마다 publish (늦은 접속자 대비)
    const now = Date.now();
    const items = await Promise.all(
      live.map(async (s) => {
        const title = await titles.get(s.sessionId, transcriptPath(s), now);
        const item = toListItem(s);
        return title ? { ...item, title } : item;
      }),
    );
    const json = JSON.stringify(items);
    if (json !== lastSessionsJson || now - lastPublish > HEARTBEAT_MS) {
      lastSessionsJson = json;
      lastPublish = now;
      await rt.publishSessions({ type: "sessions", items });
    }

    // active 세션 live append
    for (const [sid, tail] of activeTails) {
      if (!liveMap.has(sid)) {
        activeTails.delete(sid);
        continue;
      }
      const events = await tail.readNew();
      if (events.length) {
        await rt.publishTx({ type: "tx", sessionId: sid, events });
        console.log(`${DIM}↑ tx ${shortId(sid)}: ${events.length}${RESET}`);
      }
    }

    await sleep(POLL_MS);
  }

  await rt.close();
  console.log(`${DIM}bye${RESET}`);
}

function chunk<T>(arr: T[], n: number): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < arr.length; i += n) out.push(arr.slice(i, i + n));
  return out;
}

// ───────────────────────── 콘솔 모드 (M1) ─────────────────────────

function label(s: SessionFile): string {
  return `${shortId(s.sessionId)} ${basename(s.cwd)}`;
}

async function runConsole(argv: string[]): Promise<void> {
  const fromStart = argv.includes("--from-start") || argv.includes("-a");
  const sessionFilter = argv.find((a) => !a.startsWith("-"));
  const matches = (s: SessionFile) =>
    !sessionFilter || s.sessionId === sessionFilter || s.sessionId.startsWith(sessionFilter);

  let live = (await liveSessions(await scanSessions())).filter(matches);
  if (live.length === 0) {
    console.log(`${DIM}(live 세션 없음)${RESET}`);
  } else {
    console.log(`${BOLD}live 세션 ${live.length}개:${RESET}`);
    for (const s of live) console.log(`  ${BOLD}${shortId(s.sessionId)}${RESET}  ${s.cwd}  ${DIM}pid ${s.pid}${RESET}`);
    console.log("");
  }

  const tails = new Map<string, TranscriptTail>();
  for (const s of live) {
    const t = new TranscriptTail(transcriptPath(s));
    const initial = await t.init(fromStart);
    tails.set(s.sessionId, t);
    for (const ev of initial) console.log(renderEvent(ev, label(s)));
  }
  console.log(`${DIM}…watching (Ctrl-C 종료)${RESET}`);

  let stopped = false;
  process.on("SIGINT", () => (stopped = true));
  process.on("SIGTERM", () => (stopped = true));

  while (!stopped) {
    const current = (await liveSessions(await scanSessions())).filter(matches);
    const byId = new Map(current.map((s) => [s.sessionId, s]));
    for (const s of current) {
      if (!tails.has(s.sessionId)) {
        const t = new TranscriptTail(transcriptPath(s));
        await t.init(false);
        tails.set(s.sessionId, t);
        console.log(`${DIM}+ 새 세션 ${label(s)}${RESET}`);
      }
    }
    for (const id of [...tails.keys()]) if (!byId.has(id)) tails.delete(id);
    for (const [id, t] of tails) {
      const s = byId.get(id);
      if (!s) continue;
      const events: RenderEvent[] = await t.readNew();
      for (const ev of events) console.log(renderEvent(ev, label(s)));
    }
    await sleep(POLL_MS);
  }
  console.log(`${DIM}bye${RESET}`);
}
