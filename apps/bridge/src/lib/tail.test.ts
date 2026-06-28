import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtemp, rm, writeFile, appendFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { TranscriptTail } from "./tail.js";

const userLine = (text: string) =>
  JSON.stringify({ type: "user", message: { role: "user", content: text } }) + "\n";
const titleLine = (title: string) =>
  JSON.stringify({ type: "ai-title", aiTitle: title }) + "\n";

describe("TranscriptTail", () => {
  let dir: string;
  let path: string;

  beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), "decku-tail-"));
    path = join(dir, "s.jsonl");
  });
  afterEach(async () => {
    await rm(dir, { recursive: true, force: true });
  });

  it("init(fromStart=true) → 전체 이벤트", async () => {
    await writeFile(path, titleLine("제목") + userLine("hi"));
    const t = new TranscriptTail(path);
    const evs = await t.init(true);
    expect(evs).toHaveLength(2);
    expect(evs[0]).toMatchObject({ kind: "title", title: "제목" });
  });

  it("init(fromStart=false) → 이후 append만", async () => {
    await writeFile(path, userLine("before"));
    const t = new TranscriptTail(path);
    expect(await t.init(false)).toEqual([]); // 기존 내용 skip
    await appendFile(path, userLine("after"));
    const evs = await t.readNew();
    expect(evs).toHaveLength(1);
    expect(evs[0]).toMatchObject({ role: "user", blocks: [{ type: "text", text: "after" }] });
  });

  it("부분 줄(개행 없는 꼬리)은 다음 read까지 보류", async () => {
    const t = new TranscriptTail(path);
    await t.init(false);
    const full = userLine("나눠진 줄");
    const cut = Math.floor(full.length / 2);
    await writeFile(path, full.slice(0, cut)); // 개행 전까지
    expect(await t.readNew()).toEqual([]); // 아직 미완성
    await appendFile(path, full.slice(cut)); // 나머지 + 개행
    const evs = await t.readNew();
    expect(evs).toHaveLength(1);
    expect(evs[0]).toMatchObject({ blocks: [{ type: "text", text: "나눠진 줄" }] });
  });

  it("멀티바이트(한글) 경계 분할에도 안전", async () => {
    const t = new TranscriptTail(path);
    await t.init(false);
    const line = userLine("가나다라마바사");
    const buf = Buffer.from(line, "utf8");
    // 한글 한 글자(3바이트) 중간에서 자름
    await writeFile(path, buf.subarray(0, 20));
    await t.readNew();
    await appendFile(path, buf.subarray(20));
    const evs = await t.readNew();
    expect(evs[0]).toMatchObject({ blocks: [{ type: "text", text: "가나다라마바사" }] });
  });

  it("truncate(파일 축소) 시 offset 리셋", async () => {
    await writeFile(path, userLine("x".repeat(80))); // 긴 원본
    const t = new TranscriptTail(path);
    await t.init(false); // offset = 큰 값
    await writeFile(path, userLine("fresh")); // 더 짧게 덮어씀 → size < offset
    const evs = await t.readNew();
    expect(evs.map((e: any) => e.blocks[0].text)).toContain("fresh");
  });

  it("파일이 아직 없으면 빈 배열", async () => {
    const t = new TranscriptTail(join(dir, "nope.jsonl"));
    expect(await t.init(false)).toEqual([]);
    expect(await t.readNew()).toEqual([]);
  });
});
