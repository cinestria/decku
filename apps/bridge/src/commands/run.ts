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
import { createPairing, printPairing, pairUrl } from "./pair.js";
import { ReplayGuard } from "../lib/replay.js";
import { BridgeRealtime } from "../lib/realtime.js";
import { injectMessage, checkClaudeAuth, claudeLogin } from "../lib/inject.js";
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

/** realtime 연결 전 claude 인증 확인. 만료/미인증이면 (TTY에서) `claude login` 유도 후 재확인. */
async function ensureClaudeAuth(): Promise<void> {
  process.stdout.write(`${DIM}claude 인증 확인 중…${RESET} `);
  let auth = await checkClaudeAuth();
  if (auth.ok) {
    console.log(`${DIM}✓${RESET}`);
    return;
  }
  console.log(`\n${BOLD}⚠ claude 인증이 필요합니다${RESET} ${DIM}(${auth.detail})${RESET}`);

  if (process.stdin.isTTY) {
    console.log(`${DIM}로그인을 진행합니다 — 브라우저에서 완료하세요…${RESET}\n`);
    await claudeLogin();
    auth = await checkClaudeAuth();
    if (auth.ok) {
      console.log(`${DIM}✓ 인증 완료 — 메시지 전송 가능${RESET}\n`);
      return;
    }
  }
  // 비TTY(launchd 등)이거나 로그인 후에도 실패 → 읽기는 되니 계속 진행, 안내만
  console.log(
    `${BOLD}⚠ 인증 안 됨 — 읽기·목록은 되지만 메시지 전송은 안 됩니다.${RESET}\n` +
      `${DIM}   터미널에서  ${RESET}${BOLD}claude login${RESET}${DIM}  또는  ${RESET}${BOLD}export ANTHROPIC_API_KEY=sk-ant-...${RESET}${DIM}  후 decku 재시작.${RESET}\n`,
  );
}

// ───────────────────────── realtime 모드 ─────────────────────────

async function runRealtime(cfg: NonNullable<Awaited<ReturnType<typeof loadConfig>>>, argv: string[]): Promise<void> {
  // realtime 연결 전에 claude 인증부터 (메시지 전송에 필요). 만료면 로그인 유도.
  await ensureClaudeAuth();

  console.log(`${BOLD}decku${RESET} realtime 연결 중… (namespace ${shortId(cfg.namespace)}…)`);
  const rt = new BridgeRealtime(cfg);

  // 브라우저가 연 세션만 live tail (그 외엔 목록만)
  const activeTails = new Map<string, TranscriptTail>();
  const titles = new TitleCache();
  const replay = new ReplayGuard();
  let liveMap = new Map<string, SessionFile>();

  await rt.connect((cmd: CmdPayload) => {
    void handleCmd(cmd).catch((e) => console.error("cmd 처리 실패:", e));
  });

  // 페어링 QR — 폰/웹에서 스캔해 열기 (Claude Remote처럼). namespace는 고정이라 항상 같은 코드.
  const url = pairUrl(cfg);
  console.log(`\n${BOLD}폰/웹에서 스캔해 열기:${RESET}`);
  qrcode.generate(url, { small: true });
  console.log(`${DIM}  ${url}${RESET}\n`);
  console.log(`${DIM}연결됨. watching… (Ctrl-C 종료)${RESET}`);

  async function handleCmd(cmd: CmdPayload): Promise<void> {
    const resolvePath = async (sid: string): Promise<string | undefined> => {
      const s = liveMap.get(sid);
      return s ? transcriptPath(s) : (await findTranscript(sid))?.path;
    };

    if (cmd.op === "load") {
      const s = liveMap.get(cmd.sessionId);
      const path = await resolvePath(cmd.sessionId);
      if (!path) {
        console.log(`${DIM}load: 세션 ${shortId(cmd.sessionId)} 못 찾음${RESET}`);
        return;
      }
      // tail backfill — 마지막 청크만 (위로 스와이프하면 loadMore로 옛날 청크)
      const all = await new TranscriptTail(path).init(true);
      const total = all.length;
      const start = Math.max(0, total - BACKFILL_CHUNK);
      await rt.publishTx({
        type: "tx",
        sessionId: cmd.sessionId,
        events: all.slice(start),
        firstIndex: start,
        total,
        done: true,
      });
      console.log(`${DIM}backfill(tail) ${shortId(cmd.sessionId)}: ${total - start}/${total}${RESET}`);
      // live 세션만 이후 append 추적 (과거 세션은 append 없음)
      if (s && !activeTails.has(cmd.sessionId)) {
        const t = new TranscriptTail(path);
        await t.init(false);
        activeTails.set(cmd.sessionId, t);
      }
    } else if (cmd.op === "loadMore") {
      const path = await resolvePath(cmd.sessionId);
      if (!path) return;
      const all = await new TranscriptTail(path).init(true);
      const before = Math.max(0, Math.min(cmd.before, all.length));
      const start = Math.max(0, before - BACKFILL_CHUNK);
      if (start >= before) return; // 더 없음
      await rt.publishTx({
        type: "tx",
        sessionId: cmd.sessionId,
        events: all.slice(start, before),
        firstIndex: start,
        total: all.length,
      });
      console.log(`${DIM}backfill(older) ${shortId(cmd.sessionId)}: [${start},${before})${RESET}`);
    } else if (cmd.op === "send") {
      // 재전송 방어: 오래되거나 중복된(또는 ts/nonce 없는) send는 주입 거부
      if (!replay.check(cmd.nonce, cmd.ts)) {
        console.warn(`${DIM}↯ replay/stale send 무시 ${shortId(cmd.sessionId)} (페이지 새로고침 필요할 수 있음)${RESET}`);
        return;
      }
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
      console.log(`${DIM}↓ send ${shortId(cmd.sessionId)}: "${cmd.text.slice(0, 40)}"${imgN ? ` (+${imgN} img)` : ""} (응답 생성 중…)${RESET}`);
      // 한 턴(응답까지)이라 시간 소요 → fire-and-forget, append는 tail이 publish
      const t0 = Date.now();
      injectMessage(found.cwd, cmd.sessionId, cmd.text, cmd.images)
        .then(() => console.log(`${DIM}  inject 완료 ${shortId(cmd.sessionId)} (${((Date.now() - t0) / 1000).toFixed(1)}s)${RESET}`))
        .catch((e) => {
          const msg = (e as Error).message;
          console.error(`inject 실패 ${shortId(cmd.sessionId)}:`, msg);
          // 웹에도 알림 (대화에 일시적 경고 — jsonl엔 없어 새로고침 시 사라짐)
          void rt
            .publishTx({
              type: "tx",
              sessionId: cmd.sessionId,
              events: [{ kind: "message", role: "assistant", blocks: [{ type: "text", text: `⚠ 전송 실패: ${msg}` }] }],
            })
            .catch(() => {});
        });
    } else if (cmd.op === "history") {
      const items = await historyList(cmd.limit ?? 40);
      await rt.publishHistory({ type: "history", items });
      console.log(`${DIM}↑ history: ${items.length}${RESET}`);
    }
  }

  let stopped = false;
  const shutdown = () => {
    if (stopped) process.exit(0); // 두 번째 Ctrl-C → 즉시
    stopped = true;
    console.log(`\n${DIM}종료 중…${RESET}`);
    // 정리(채널 unsubscribe)는 시도하되, 느리면 800ms 후 강제 종료
    const force = setTimeout(() => process.exit(0), 800);
    force.unref?.();
    void rt.close().finally(() => process.exit(0));
  };
  process.on("SIGINT", shutdown);
  process.on("SIGTERM", shutdown);

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
  // 루프 탈출 시 정리는 shutdown()이 처리(강제 종료 포함)
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
  const quit = () => {
    stopped = true;
    process.exit(0); // 콘솔 모드는 정리할 것 없음 → 즉시
  };
  process.on("SIGINT", quit);
  process.on("SIGTERM", quit);

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
