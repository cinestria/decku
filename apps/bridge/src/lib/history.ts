/**
 * 과거 세션 기록 — ~/.claude/projects 아래 모든 transcript(.jsonl, 닫힌 것 포함) 최근순 나열.
 * registry(live)와 달리 모든 transcript가 대상. on-demand(cmd history)로만 읽음(무거우니).
 */
import { readdir, stat } from "node:fs/promises";
import { createReadStream } from "node:fs";
import { createInterface } from "node:readline";
import { join } from "node:path";
import type { SessionListItem } from "@decku/shared";
import { PROJECTS_DIR, scanSessions } from "./sessions.js";

interface FileEntry {
  sessionId: string;
  path: string;
  mtimeMs: number;
}

async function listTranscripts(): Promise<FileEntry[]> {
  let dirs: string[];
  try {
    dirs = await readdir(PROJECTS_DIR);
  } catch {
    return [];
  }
  const out: FileEntry[] = [];
  for (const d of dirs) {
    const dirPath = join(PROJECTS_DIR, d);
    let files: string[];
    try {
      files = await readdir(dirPath);
    } catch {
      continue;
    }
    for (const f of files) {
      if (!f.endsWith(".jsonl")) continue;
      try {
        const st = await stat(join(dirPath, f));
        out.push({ sessionId: f.slice(0, -6), path: join(dirPath, f), mtimeMs: st.mtimeMs });
      } catch {
        /* skip */
      }
    }
  }
  return out;
}

/** 한 transcript에서 cwd(첫 등장)와 마지막 ai-title을 한 번에 추출. */
async function readMeta(path: string): Promise<{ cwd?: string; title?: string }> {
  let cwd: string | undefined;
  let title: string | undefined;
  let stream;
  try {
    stream = createReadStream(path, { encoding: "utf8" });
  } catch {
    return {};
  }
  const rl = createInterface({ input: stream, crlfDelay: Infinity });
  try {
    for await (const line of rl) {
      if (!cwd && line.includes('"cwd"')) {
        try {
          const d = JSON.parse(line) as { cwd?: unknown };
          if (typeof d.cwd === "string") cwd = d.cwd;
        } catch {
          /* partial */
        }
      }
      if (line.includes('"ai-title"')) {
        try {
          const d = JSON.parse(line) as { type?: string; aiTitle?: string };
          if (d.type === "ai-title" && d.aiTitle) title = d.aiTitle;
        } catch {
          /* partial */
        }
      }
    }
  } catch {
    /* read error → 부분 결과 */
  } finally {
    rl.close();
    stream.close();
  }
  return { cwd, title };
}

/** sessionId로 transcript 위치/cwd 찾기 (live가 아닌 과거 세션 load/send용). */
export async function findTranscript(
  sessionId: string,
): Promise<{ path: string; cwd: string } | null> {
  const e = (await listTranscripts()).find((x) => x.sessionId === sessionId);
  if (!e) return null;
  const meta = await readMeta(e.path);
  return { path: e.path, cwd: meta.cwd ?? "" };
}

export async function historyList(limit = 40): Promise<SessionListItem[]> {
  const recent = (await listTranscripts()).sort((a, b) => b.mtimeMs - a.mtimeMs).slice(0, limit);
  const liveIds = new Set((await scanSessions()).map((s) => s.sessionId));
  return Promise.all(
    recent.map(async (e): Promise<SessionListItem> => {
      const meta = await readMeta(e.path);
      return {
        sessionId: e.sessionId,
        pid: 0,
        cwd: meta.cwd ?? "(unknown)",
        live: liveIds.has(e.sessionId),
        startedAt: Math.round(e.mtimeMs),
        ...(meta.title ? { title: meta.title } : {}),
      };
    }),
  );
}
