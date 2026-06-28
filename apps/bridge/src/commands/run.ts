/**
 * `decku-bridge run [sessionId] [--from-start|-a]`
 *
 * M1: 로컬 단독 — live 세션 목록 출력 후, 각 세션 transcript를 tail해서 콘솔 렌더.
 * realtime/네트워크 없음. 데스크탑은 안 건드림(파일만 읽음).
 *
 *   run                 모든 live 세션을 tail (이후 append만)
 *   run <sessionId>     그 세션만
 *   run --from-start    전체 history부터 (대화 통째로 덤프)
 */
import { basename } from "node:path";
import type { SessionFile } from "@decku/shared";
import { scanSessions, liveSessions, transcriptPath } from "../lib/sessions.js";
import { TranscriptTail } from "../lib/tail.js";
import { renderEvent } from "../lib/render.js";

const POLL_MS = 800;
const DIM = "\x1b[2m";
const BOLD = "\x1b[1m";
const RESET = "\x1b[0m";

function shortId(sessionId: string): string {
  return sessionId.slice(0, 8);
}

function label(s: SessionFile): string {
  return `${shortId(s.sessionId)} ${basename(s.cwd)}`;
}

function printSessionList(sessions: SessionFile[]): void {
  if (sessions.length === 0) {
    console.log(`${DIM}(live 세션 없음 — Claude Desktop/Code 세션을 띄워보세요)${RESET}`);
    return;
  }
  console.log(`${BOLD}live 세션 ${sessions.length}개:${RESET}`);
  for (const s of sessions) {
    console.log(`  ${BOLD}${shortId(s.sessionId)}${RESET}  ${s.cwd}  ${DIM}pid ${s.pid}${RESET}`);
  }
  console.log("");
}

export async function run(argv: string[] = []): Promise<void> {
  const fromStart = argv.includes("--from-start") || argv.includes("-a");
  const sessionFilter = argv.find((a) => !a.startsWith("-"));

  const matches = (s: SessionFile) =>
    !sessionFilter || s.sessionId === sessionFilter || s.sessionId.startsWith(sessionFilter);

  let live = (await liveSessions(await scanSessions())).filter(matches);
  printSessionList(live);

  if (sessionFilter && live.length === 0) {
    console.error(`세션을 못 찾음: ${sessionFilter}`);
    process.exitCode = 1;
    return;
  }

  // sessionId → tail
  const tails = new Map<string, TranscriptTail>();
  for (const s of live) {
    const t = new TranscriptTail(transcriptPath(s));
    const initial = await t.init(fromStart);
    tails.set(s.sessionId, t);
    for (const ev of initial) console.log(renderEvent(ev, label(s)));
  }

  console.log(`${DIM}…watching (Ctrl-C 종료)${RESET}`);

  let stopped = false;
  const stop = () => {
    stopped = true;
  };
  process.on("SIGINT", stop);
  process.on("SIGTERM", stop);

  while (!stopped) {
    const current = (await liveSessions(await scanSessions())).filter(matches);
    const byId = new Map(current.map((s) => [s.sessionId, s]));

    // 새로 뜬 세션 → tail 등록 (live 시작점부터)
    for (const s of current) {
      if (!tails.has(s.sessionId)) {
        const t = new TranscriptTail(transcriptPath(s));
        await t.init(false);
        tails.set(s.sessionId, t);
        console.log(`${DIM}+ 새 세션 ${label(s)}${RESET}`);
      }
    }
    // 닫힌 세션 → tail 제거
    for (const id of [...tails.keys()]) {
      if (!byId.has(id)) {
        tails.delete(id);
        console.log(`${DIM}- 세션 종료 ${shortId(id)}${RESET}`);
      }
    }

    // 각 live tail에서 새 이벤트
    for (const [id, t] of tails) {
      const s = byId.get(id);
      if (!s) continue;
      const events = await t.readNew();
      for (const ev of events) console.log(renderEvent(ev, label(s)));
    }

    await sleep(POLL_MS);
  }

  console.log(`${DIM}bye${RESET}`);
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
