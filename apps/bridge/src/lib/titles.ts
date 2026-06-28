/**
 * 세션 제목(ai-title) 추출 + 캐시.
 *
 * 제목은 registry json이 아니라 transcript jsonl 안의 `ai-title` 줄에 있다(마지막 게 현재 제목).
 * 큰 transcript를 매 poll마다 읽지 않도록: mtime이 같으면 캐시 사용, 바뀌어도 20s 스로틀.
 * 읽을 땐 스트리밍(readline)으로 메모리 절약.
 */
import { stat } from "node:fs/promises";
import { createInterface } from "node:readline";
import { createReadStream } from "node:fs";
import { parseTranscriptLine } from "@decku/shared";

const THROTTLE_MS = 20_000;

interface Entry {
  title?: string;
  mtimeMs: number;
  checkedAt: number;
}

export class TitleCache {
  private cache = new Map<string, Entry>();

  /** 세션 제목. 없으면 undefined. 캐시/스로틀로 재읽기 최소화. */
  async get(sessionId: string, path: string, now: number): Promise<string | undefined> {
    let mtimeMs: number;
    try {
      mtimeMs = (await stat(path)).mtimeMs;
    } catch {
      return this.cache.get(sessionId)?.title; // 파일 없음 → 마지막 값
    }
    const c = this.cache.get(sessionId);
    if (c && (c.mtimeMs === mtimeMs || now - c.checkedAt < THROTTLE_MS)) {
      return c.title;
    }
    const title = await readLastAiTitle(path);
    this.cache.set(sessionId, { title, mtimeMs, checkedAt: now });
    return title;
  }
}

async function readLastAiTitle(path: string): Promise<string | undefined> {
  let title: string | undefined;
  let stream;
  try {
    stream = createReadStream(path, { encoding: "utf8" });
  } catch {
    return undefined;
  }
  const rl = createInterface({ input: stream, crlfDelay: Infinity });
  try {
    for await (const line of rl) {
      if (!line.includes('"ai-title"')) continue; // JSON.parse 전 싼 필터
      const ev = parseTranscriptLine(line);
      if (ev?.kind === "title" && ev.title) title = ev.title;
    }
  } catch {
    /* 읽기 실패 → 부분 결과 */
  } finally {
    rl.close();
    stream.close();
  }
  return title;
}
