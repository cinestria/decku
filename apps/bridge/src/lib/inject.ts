/**
 * 채팅 전송 = 세션 resume 주입.
 *
 * 텍스트만: `claude -p <text> --resume <sid>`.
 * 이미지 포함: `--input-format stream-json` 으로 user 메시지(image+text 블록)를 stdin에 흘림.
 * 사용자+응답이 같은 transcript jsonl에 append되고, tail이 tx로 publish한다.
 *
 * 주의: cwd는 반드시 그 세션의 cwd여야 transcript 경로(enc-cwd)가 일치한다.
 */
import { spawn } from "node:child_process";
import type { ImageAttachment } from "@decku/shared";

/**
 * 헤드리스 claude 인증 점검 — `claude whoami` 로 **토큰 0(추론 없음)** 검증.
 * `auth status`는 토큰 존재만 봐서 만료를 못 잡지만, whoami는 실제 검증해 만료 401을 잡는다.
 */
export function checkClaudeAuth(): Promise<{ ok: boolean; detail?: string }> {
  return new Promise((resolve) => {
    const child = spawn("claude", ["whoami"], { stdio: ["ignore", "pipe", "pipe"], env: process.env });
    let out = "";
    const timer = setTimeout(() => {
      child.kill("SIGKILL");
      resolve({ ok: false, detail: "시간 초과" });
    }, 20000);
    child.stdout?.on("data", (d) => (out += String(d)));
    child.stderr?.on("data", (d) => (out += String(d)));
    child.on("error", (e) => {
      clearTimeout(timer);
      resolve({ ok: false, detail: `claude 실행 실패: ${e.message}` });
    });
    child.on("close", () => {
      clearTimeout(timer);
      const bad = /401|failed to authenticate|invalid authentication|not logged in|logged out|no credentials/i.test(out);
      resolve(bad ? { ok: false, detail: out.trim().slice(0, 160) } : { ok: true });
    });
  });
}

/** `claude setup-token` 대화형 실행 (TTY에서만) — 헤드리스용 장기 인증 토큰을 OAuth로 발급. */
export function claudeSetupToken(): Promise<boolean> {
  return new Promise((resolve) => {
    const child = spawn("claude", ["setup-token"], { stdio: "inherit", env: process.env });
    child.on("error", () => resolve(false));
    child.on("close", (code) => resolve(code === 0));
  });
}

export function injectMessage(
  cwd: string,
  sessionId: string,
  text: string,
  images?: ImageAttachment[],
): Promise<void> {
  if (!images || images.length === 0) {
    return runClaude(cwd, ["-p", text, "--resume", sessionId, "--output-format", "json"]);
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
    ["-p", "--resume", sessionId, "--input-format", "stream-json", "--output-format", "stream-json", "--verbose"],
    line,
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
async function runClaude(cwd: string, args: string[], stdin?: string, attempt = 0): Promise<void> {
  try {
    await spawnClaude(cwd, args, stdin);
  } catch (e) {
    const msg = (e as Error).message;
    if (attempt < 2 && isTransient(msg)) {
      await sleep(800 * (attempt + 1));
      return runClaude(cwd, args, stdin, attempt + 1);
    }
    throw e;
  }
}

const INJECT_TIMEOUT_MS = 2 * 60 * 1000; // 응답이 이 시간 넘게 안 끝나면 멈춘 것으로 보고 종료

function spawnClaude(cwd: string, args: string[], stdin?: string): Promise<void> {
  return new Promise((resolve, reject) => {
    const child = spawn("claude", args, {
      cwd,
      // stdout도 캡처 — `--output-format json`은 실패 사유를 stdout(JSON)에 쓴다.
      stdio: [stdin ? "pipe" : "ignore", "pipe", "pipe"],
      env: process.env,
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
      reject(e);
    });
    child.on("close", (code) => {
      clearTimeout(timer);
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
