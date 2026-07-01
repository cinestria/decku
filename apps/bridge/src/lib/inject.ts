/**
 * 채팅 전송 = 세션 resume 주입.
 *
 * 텍스트만: `claude -p <text> --resume <sid>`.
 * 이미지 포함: `--input-format stream-json` 으로 user 메시지(image+text 블록)를 stdin에 흘림.
 * 사용자+응답이 같은 transcript jsonl에 append되고, tail이 tx로 publish한다.
 *
 * 주의: cwd는 반드시 그 세션의 cwd여야 transcript 경로(enc-cwd)가 일치한다.
 */
import { spawn, type ChildProcess } from "node:child_process";
import { createInterface } from "node:readline";
import { existsSync } from "node:fs";
import { homedir } from "node:os";
import { join, delimiter } from "node:path";
import type { ImageAttachment } from "@decku/shared";

/**
 * `claude` 실행파일 경로 해석. launchd/자동시작 등 PATH가 빈약한 환경에서도 찾도록:
 *  env 오버라이드 → PATH 탐색 → 흔한 설치 위치(native installer/npm/homebrew) 순. 못 찾으면 "claude"(PATH에 맡김).
 * `spawn("claude")`가 ENOENT로 실패하던 문제(브릿지 PATH에 ~/.local/bin 등이 없을 때) 대응.
 */
let cachedBin: string | undefined;
function claudeBin(): string {
  if (cachedBin) return cachedBin;
  const override = process.env.DECKU_CLAUDE_BIN || process.env.CLAUDE_BIN;
  if (override && existsSync(override)) return (cachedBin = override);
  for (const dir of (process.env.PATH ?? "").split(delimiter)) {
    if (dir && existsSync(join(dir, "claude"))) return (cachedBin = join(dir, "claude"));
  }
  const home = homedir();
  const candidates = [
    join(home, ".local", "bin", "claude"),
    join(home, ".claude", "local", "claude"),
    "/opt/homebrew/bin/claude",
    "/usr/local/bin/claude",
    join(home, ".npm-global", "bin", "claude"),
  ];
  for (const c of candidates) if (existsSync(c)) return (cachedBin = c);
  return "claude";
}

/** 해석된 claude 경로의 디렉터리를 PATH 앞에 붙인 env — claude가 자기 헬퍼(node 등)를 찾을 수 있게. */
function claudeEnv(): NodeJS.ProcessEnv {
  const bin = claudeBin();
  const i = bin.lastIndexOf("/");
  if (i <= 0) return process.env;
  const dir = bin.slice(0, i);
  const PATH = process.env.PATH ?? "";
  if (PATH.split(delimiter).includes(dir)) return process.env;
  return { ...process.env, PATH: `${dir}${delimiter}${PATH}` };
}

// 진행 중인 inject 프로세스 (세션별) — 웹의 '중단'으로 kill 하기 위함
const running = new Map<string, ChildProcess>();
const cancelled = new Set<string>();

/** 진행 중인 그 세션의 inject를 중단. 성공 시 true. */
export function cancelInject(sessionId: string): boolean {
  const child = running.get(sessionId);
  if (!child) return false;
  cancelled.add(sessionId);
  child.kill("SIGTERM");
  return true;
}

/**
 * claude 로그인 여부 — `claude auth status` 로 **API 호출·세션 생성·토큰 소모 0** (로컬 자격증명만 읽음).
 * 만료 검증은 못 함(저장된 토큰 있으면 true) → 만료는 사용 중 401(`isAuthError`)로 잡아 재로그인.
 */
export function claudeLoggedIn(): Promise<boolean> {
  return new Promise((resolve) => {
    const child = spawn(claudeBin(), ["auth", "status"], { stdio: ["ignore", "pipe", "pipe"], env: claudeEnv() });
    let out = "";
    const timer = setTimeout(() => {
      child.kill("SIGKILL");
      resolve(false);
    }, 15000);
    child.stdout?.on("data", (d) => (out += String(d)));
    child.on("error", () => {
      clearTimeout(timer);
      resolve(false);
    });
    child.on("close", () => {
      clearTimeout(timer);
      try {
        resolve((JSON.parse(out.trim()) as { loggedIn?: boolean }).loggedIn === true);
      } catch {
        resolve(false);
      }
    });
  });
}

/** spawn ENOENT(claude 실행파일 못 찾음)를 사람이 읽을 안내로 바꾼다. */
function enoentHint(e: Error): Error {
  if ((e as NodeJS.ErrnoException).code === "ENOENT") {
    return new Error(
      "claude 실행파일을 찾지 못했습니다 — 브릿지 PATH에 claude가 없습니다. " +
        "'which claude'가 되는 터미널에서 decku를 재시작하거나, 환경변수 DECKU_CLAUDE_BIN=<claude 경로>로 지정하세요.",
    );
  }
  return e;
}

/** claude 출력이 인증 만료/무효(401) 에러인가 — 토큰 삭제+재로그인 트리거용. */
export function isAuthError(msg: string): boolean {
  return /invalid authentication|authentication credentials|failed to authenticate|401/i.test(msg);
}

/**
 * `claude setup-token` — 헤드리스용 장기 OAuth 토큰 발급.
 * 깨끗한 TUI(inherit)로 실행해 사용자가 브라우저 로그인 + 토큰 확인 → 그 토큰을 붙여넣게 받아 반환.
 * (stdout을 pipe하면 Ink TUI가 화면을 도배하므로 inherit + paste 방식)
 */
export async function claudeSetupToken(): Promise<string | null> {
  await new Promise<void>((resolve) => {
    const child = spawn(claudeBin(), ["setup-token"], { stdio: "inherit", env: claudeEnv() });
    child.on("error", () => resolve());
    child.on("close", () => resolve());
  });
  // setup-token이 보여준 sk-ant-oat… 토큰을 붙여넣게 받음
  const rl = createInterface({ input: process.stdin, output: process.stdout });
  const ans = await new Promise<string>((resolve) =>
    rl.question("\n위에 나온 토큰(sk-ant-oat…)을 붙여넣고 Enter (건너뛰려면 그냥 Enter): ", resolve),
  );
  rl.close();
  const m = ans.match(/sk-ant-oat\d+-[A-Za-z0-9_-]+/);
  return m ? m[0] : null;
}

/** 새 세션 시작 — cwd에서 첫 메시지로 `claude -p`(--resume 없이) → 새 session_id 반환. */
export function createSession(cwd: string, text: string): Promise<{ sessionId?: string; error?: string }> {
  return new Promise((resolve) => {
    const child = spawn(claudeBin(), ["-p", text, "--output-format", "json"], {
      cwd,
      stdio: ["ignore", "pipe", "pipe"],
      env: claudeEnv(),
    });
    let out = "";
    let err = "";
    let timedOut = false;
    const timer = setTimeout(() => {
      timedOut = true;
      child.kill("SIGKILL");
    }, INJECT_TIMEOUT_MS);
    child.stdout?.on("data", (d) => (out += String(d)));
    child.stderr?.on("data", (d) => (err += String(d)));
    child.on("error", (e) => {
      clearTimeout(timer);
      resolve({ error: enoentHint(e).message });
    });
    child.on("close", () => {
      clearTimeout(timer);
      if (timedOut) return resolve({ error: "응답 시간 초과(>2분)" });
      try {
        const j = JSON.parse(out.trim()) as { session_id?: string; is_error?: boolean; result?: string };
        if (j.is_error) return resolve({ error: j.result ?? "오류" });
        return j.session_id ? resolve({ sessionId: j.session_id }) : resolve({ error: "session_id 없음" });
      } catch {
        resolve({ error: (err.trim() || extractClaudeError(out) || "파싱 실패").slice(0, 200) });
      }
    });
  });
}

export function injectMessage(
  cwd: string,
  sessionId: string,
  text: string,
  images?: ImageAttachment[],
  mode?: string,
): Promise<void> {
  const perm = mode && mode !== "default" ? ["--permission-mode", mode] : [];
  if (!images || images.length === 0) {
    return runClaude(cwd, ["-p", text, "--resume", sessionId, "--output-format", "json", ...perm], undefined, sessionId);
  }

  // 이미지 → stream-json 입력 (Messages API content 블록)
  const content: unknown[] = images.map((img) => ({
    type: "image",
    source: { type: "base64", media_type: img.mediaType, data: img.dataBase64 },
  }));
  if (text) content.push({ type: "text", text });
  const line = JSON.stringify({ type: "user", message: { role: "user", content } }) + "\n";

  return runClaude(
    cwd,
    // -p + stream-json 출력은 claude가 --verbose 를 요구함
    ["-p", "--resume", sessionId, "--input-format", "stream-json", "--output-format", "stream-json", "--verbose", ...perm],
    line,
    sessionId,
  );
}

const sleep = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms));

/** 일시적(네트워크/과부하) 실패 — 재시도하면 풀릴 만한 것.
 *  주의: "Invalid authentication credentials"(영구 401)은 재시도 무의미 → 제외해 즉시 실패 표시.
 *  (소켓 끊김發 401은 "socket"/"closed unexpectedly"로 잡혀 재시도됨) */
function isTransient(msg: string): boolean {
  if (/invalid authentication|authentication credentials/i.test(msg)) return false;
  return /socket|closed unexpectedly|fetch failed|ECONNRESET|ETIMEDOUT|ENOTFOUND|EAI_AGAIN|network|429|408|5\d\d|overloaded|timeout/i.test(
    msg,
  );
}

/** 일시적 실패는 짧은 백오프로 최대 2회 재시도(주입은 멱등하지 않지만, 인증/소켓 실패는 주입 전이라 안전). */
async function runClaude(cwd: string, args: string[], stdin?: string, sid?: string, attempt = 0): Promise<void> {
  try {
    await spawnClaude(cwd, args, stdin, sid);
  } catch (e) {
    const msg = (e as Error).message;
    if (msg === "__cancelled__") throw e; // 사용자 중단 → 재시도 안 함
    if (attempt < 2 && isTransient(msg)) {
      await sleep(800 * (attempt + 1));
      return runClaude(cwd, args, stdin, sid, attempt + 1);
    }
    throw e;
  }
}

const INJECT_TIMEOUT_MS = 2 * 60 * 1000; // 응답이 이 시간 넘게 안 끝나면 멈춘 것으로 보고 종료

function spawnClaude(cwd: string, args: string[], stdin?: string, sid?: string): Promise<void> {
  return new Promise((resolve, reject) => {
    const child = spawn(claudeBin(), args, {
      cwd,
      // stdout도 캡처 — `--output-format json`은 실패 사유를 stdout(JSON)에 쓴다.
      stdio: [stdin ? "pipe" : "ignore", "pipe", "pipe"],
      env: claudeEnv(),
    });
    if (sid) running.set(sid, child); // 중단 가능하게 등록
    let out = "";
    let err = "";
    let timedOut = false;
    const timer = setTimeout(() => {
      timedOut = true;
      child.kill("SIGKILL");
    }, INJECT_TIMEOUT_MS);
    child.stdout?.on("data", (d) => (out += String(d)));
    child.stderr?.on("data", (d) => (err += String(d)));
    child.on("error", (e) => {
      clearTimeout(timer);
      if (sid) running.delete(sid);
      reject(enoentHint(e));
    });
    child.on("close", (code) => {
      clearTimeout(timer);
      if (sid) running.delete(sid);
      if (sid && cancelled.delete(sid)) return reject(new Error("__cancelled__")); // 사용자 중단
      if (timedOut) {
        return reject(
          new Error(`응답 시간 초과(>${INJECT_TIMEOUT_MS / 60000}분). 현재 작업 중인 바로 그 세션이면 충돌할 수 있어요 — 다른 세션으로 시도해 보세요.`),
        );
      }
      if (code === 0) return resolve();
      // stderr 우선, 비어 있으면 stdout(JSON 에러 result)에서 사유 추출.
      const detail = (err.trim() || extractClaudeError(out) || "(출력 없음)").slice(0, 300);
      reject(new Error(`claude exit ${code}: ${detail}`));
    });
    if (stdin && child.stdin) {
      // claude가 입력을 다 읽기 전에 닫으면 write가 EPIPE → 'error' 이벤트가 unhandled면 프로세스 크래시.
      // 핸들러로 삼키고, 실제 실패 사유는 close(exit code/stderr)에서 보고.
      child.stdin.on("error", () => {});
      child.stdin.write(stdin);
      child.stdin.end();
    }
  });
}

/** `--output-format json` 실패 시 stdout의 result/error 메시지를 뽑는다. */
function extractClaudeError(out: string): string {
  const trimmed = out.trim();
  if (!trimmed) return "";
  try {
    const j = JSON.parse(trimmed) as { error?: string; result?: string; is_error?: boolean };
    return j.error ?? j.result ?? trimmed;
  } catch {
    return trimmed; // JSON 아니면 원문 그대로
  }
}
