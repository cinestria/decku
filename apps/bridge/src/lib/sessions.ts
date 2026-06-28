/**
 * 세션 레지스트리 스캔 — `~/.claude/sessions/*.json`.
 *
 * 떠 있는 Claude Desktop/Code 세션마다 한 파일. live 여부는 pid 생존으로 판단.
 */
import { readdir, readFile } from "node:fs/promises";
import { join } from "node:path";
import { homedir } from "node:os";
import { SessionFileSchema, encCwd, type SessionFile } from "@decku/shared";

export const CLAUDE_DIR = join(homedir(), ".claude");
export const SESSIONS_DIR = join(CLAUDE_DIR, "sessions");
export const PROJECTS_DIR = join(CLAUDE_DIR, "projects");

/**
 * pid가 살아있나. `kill(pid, 0)`은 시그널을 안 보내고 존재만 확인.
 * - 성공 → 살아있음
 * - ESRCH → 없음
 * - EPERM → 존재하나 내 권한 밖(= 살아있음으로 취급)
 */
export function isAlive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch (err) {
    return (err as NodeJS.ErrnoException).code === "EPERM";
  }
}

/** sessions 디렉터리의 모든 *.json 파싱 (깨진 파일은 건너뜀). */
export async function scanSessions(): Promise<SessionFile[]> {
  let names: string[];
  try {
    names = await readdir(SESSIONS_DIR);
  } catch {
    return [];
  }
  const out: SessionFile[] = [];
  for (const name of names) {
    if (!name.endsWith(".json")) continue;
    try {
      const raw = await readFile(join(SESSIONS_DIR, name), "utf8");
      const parsed = SessionFileSchema.safeParse(JSON.parse(raw));
      if (parsed.success) out.push(parsed.data);
    } catch {
      // append 도중이거나 깨진 파일 → 무시
    }
  }
  return out;
}

/** live(pid 생존) 세션만. */
export function liveSessions(sessions: SessionFile[]): SessionFile[] {
  return sessions.filter((s) => isAlive(s.pid));
}

/** 세션의 transcript jsonl 경로. */
export function transcriptPath(s: Pick<SessionFile, "cwd" | "sessionId">): string {
  return join(PROJECTS_DIR, encCwd(s.cwd), `${s.sessionId}.jsonl`);
}
