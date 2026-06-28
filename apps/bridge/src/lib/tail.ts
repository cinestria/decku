/**
 * Transcript jsonl byte-offset tail.
 *
 * append-only 파일에서 **새로 붙은 바이트만** 읽어 RenderEvent로 변환.
 * - byte offset을 추적해 매 poll마다 [offset, size)만 읽음.
 * - 멀티바이트 UTF-8/부분 줄 안전: 남은 바이트(미완성 줄)를 Buffer로 보관해 다음 read에 이어붙임.
 * - 파일이 줄어들면(rotate/truncate) offset 리셋.
 */
import { open, stat } from "node:fs/promises";
import { parseTranscriptLine, type RenderEvent } from "@decku/shared";

const NL = 0x0a;

export class TranscriptTail {
  private offset = 0;
  /** 아직 개행을 못 만난 미완성 줄의 바이트. */
  private rem: Buffer = Buffer.alloc(0);

  constructor(public readonly path: string) {}

  /**
   * 초기화. fromStart=false면 현재 파일 끝으로 offset을 옮겨 "이후 append만" 받음.
   * fromStart=true면 처음부터 읽어 전체 이벤트를 즉시 반환.
   */
  async init(fromStart: boolean): Promise<RenderEvent[]> {
    if (fromStart) {
      this.offset = 0;
      this.rem = Buffer.alloc(0);
      return this.readNew();
    }
    try {
      const st = await stat(this.path);
      this.offset = st.size;
    } catch {
      this.offset = 0; // 아직 파일 없음 → 0에서 시작
    }
    return [];
  }

  /** offset 이후 새 바이트를 읽어 완성된 줄들을 RenderEvent로. */
  async readNew(): Promise<RenderEvent[]> {
    let size: number;
    try {
      size = (await stat(this.path)).size;
    } catch {
      return []; // 파일 아직 없음
    }

    if (size < this.offset) {
      // truncate/rotate → 리셋
      this.offset = 0;
      this.rem = Buffer.alloc(0);
    }
    if (size === this.offset) return [];

    const len = size - this.offset;
    const chunk = Buffer.alloc(len);
    const fd = await open(this.path, "r");
    try {
      await fd.read(chunk, 0, len, this.offset);
    } finally {
      await fd.close();
    }
    this.offset = size;

    const data = Buffer.concat([this.rem, chunk]);
    const events: RenderEvent[] = [];
    let start = 0;
    for (let i = 0; i < data.length; i++) {
      if (data[i] === NL) {
        const ev = parseTranscriptLine(data.subarray(start, i).toString("utf8"));
        if (ev) events.push(ev);
        start = i + 1;
      }
    }
    this.rem = data.subarray(start);
    return events;
  }
}
