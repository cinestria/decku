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
      stdio: [stdin ? "pipe" : "ignore", "ignore", "pipe"],
      env: process.env,
    });
    let err = "";
    child.stderr?.on("data", (d) => (err += String(d)));
    child.on("error", reject);
    child.on("close", (code) =>
      code === 0 ? resolve() : reject(new Error(`claude exit ${code}: ${err.slice(0, 200)}`)),
    );
    if (stdin && child.stdin) {
      child.stdin.write(stdin);
      child.stdin.end();
    }
  });
}
