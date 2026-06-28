/**
 * 채팅 전송 = 세션 resume 주입.
 *
 * 떠 있는 GUI 세션에 외부에서 메시지를 꽂는 공식 API가 없어, 같은 sessionId를
 * `claude -p <text> --resume <sid>` 로 이어받아 한 턴을 돌린다. 사용자+응답이 같은
 * transcript jsonl에 append되고, 그걸 tail이 tx로 publish한다.
 *
 * 주의: cwd는 반드시 그 세션의 cwd여야 transcript 경로(enc-cwd)가 일치한다.
 */
import { spawn } from "node:child_process";

export function injectMessage(cwd: string, sessionId: string, text: string): Promise<void> {
  return new Promise((resolve, reject) => {
    const child = spawn("claude", ["-p", text, "--resume", sessionId, "--output-format", "json"], {
      cwd,
      stdio: ["ignore", "ignore", "pipe"],
      env: process.env,
    });
    let err = "";
    child.stderr.on("data", (d) => (err += String(d)));
    child.on("error", reject);
    child.on("close", (code) =>
      code === 0 ? resolve() : reject(new Error(`claude exit ${code}: ${err.slice(0, 200)}`)),
    );
  });
}
