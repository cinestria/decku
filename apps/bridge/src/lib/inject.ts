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
    ["-p", "--resume", sessionId, "--input-format", "stream-json", "--output-format", "stream-json"],
    line,
  );
}

function runClaude(cwd: string, args: string[], stdin?: string): Promise<void> {
  return new Promise((resolve, reject) => {
    const child = spawn("claude", args, {
      cwd,
      // stdout도 캡처 — `--output-format json`은 실패 사유를 stdout(JSON)에 쓴다.
      stdio: [stdin ? "pipe" : "ignore", "pipe", "pipe"],
      env: process.env,
    });
    let out = "";
    let err = "";
    child.stdout?.on("data", (d) => (out += String(d)));
    child.stderr?.on("data", (d) => (err += String(d)));
    child.on("error", reject);
    child.on("close", (code) => {
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
