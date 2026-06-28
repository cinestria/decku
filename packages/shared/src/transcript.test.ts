import { describe, it, expect } from "vitest";
import { readFileSync, existsSync, readdirSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { homedir } from "node:os";
import { parseTranscript, parseTranscriptLine } from "./transcript.js";

const here = dirname(fileURLToPath(import.meta.url));
const fixture = readFileSync(join(here, "fixtures", "sample.jsonl"), "utf8");

describe("parseTranscriptLine", () => {
  it("ai-title → title 이벤트", () => {
    const ev = parseTranscriptLine('{"type":"ai-title","aiTitle":"제목","sessionId":"s1"}');
    expect(ev).toEqual({ kind: "title", title: "제목", sessionId: "s1" });
  });

  it("user 문자열 content → 단일 text 블록", () => {
    const ev = parseTranscriptLine('{"type":"user","message":{"role":"user","content":"hi"},"uuid":"u1"}');
    expect(ev).toMatchObject({ kind: "message", role: "user", blocks: [{ type: "text", text: "hi" }], uuid: "u1" });
  });

  it("assistant 블록 배열 → thinking/text/tool_use 정규화", () => {
    const line =
      '{"type":"assistant","message":{"role":"assistant","content":[{"type":"thinking","thinking":"t"},{"type":"text","text":"hello"},{"type":"tool_use","name":"Read","id":"x"}]}}';
    const ev = parseTranscriptLine(line);
    expect(ev).toMatchObject({
      kind: "message",
      role: "assistant",
      blocks: [
        { type: "thinking", text: "t" },
        { type: "text", text: "hello" },
        { type: "tool_use", name: "Read", id: "x" },
      ],
    });
  });

  it("tool_result content(배열) → 텍스트 추출", () => {
    const line =
      '{"type":"user","message":{"role":"user","content":[{"type":"tool_result","content":[{"type":"text","text":"out"}]}]}}';
    const ev = parseTranscriptLine(line);
    expect(ev).toMatchObject({ kind: "message", role: "user", blocks: [{ type: "tool_result", text: "out" }] });
  });

  it("렌더 대상 아닌 타입은 null", () => {
    expect(parseTranscriptLine('{"type":"attachment","attachment":{}}')).toBeNull();
    expect(parseTranscriptLine('{"type":"queue-operation","content":"x"}')).toBeNull();
    expect(parseTranscriptLine('{"type":"system","content":"x"}')).toBeNull();
    expect(parseTranscriptLine('{"type":"last-prompt"}')).toBeNull();
  });

  it("빈 줄·잘린 줄(append 중)은 null, throw 안 함", () => {
    expect(parseTranscriptLine("")).toBeNull();
    expect(parseTranscriptLine("   ")).toBeNull();
    expect(parseTranscriptLine('{"type":"user","message":{"role":"user","cont')).toBeNull();
  });

  it("빈 content 메시지는 null", () => {
    expect(parseTranscriptLine('{"type":"assistant","message":{"role":"assistant","content":[]}}')).toBeNull();
  });
});

describe("parseTranscript (fixture 전체)", () => {
  const events = parseTranscript(fixture);

  it("렌더 대상만 남긴다 (title 1 + message 4)", () => {
    expect(events).toHaveLength(5);
    expect(events[0]).toMatchObject({ kind: "title", title: "테스트 세션 제목" });
    expect(events.filter((e) => e.kind === "message")).toHaveLength(4);
  });

  it("순서 보존 (user → assistant → assistant → user)", () => {
    const roles = events.filter((e) => e.kind === "message").map((e: any) => e.role);
    expect(roles).toEqual(["user", "assistant", "assistant", "user"]);
  });
});

// 실제 로컬 Claude transcript가 있으면 추가 검증 (없으면 skip — CI 안전).
describe("실제 ~/.claude transcript smoke", () => {
  const root = join(homedir(), ".claude", "projects");
  const realFile = existsSync(root)
    ? readdirSync(root)
        .map((d) => join(root, d))
        .flatMap((d) => {
          try {
            return readdirSync(d).filter((f) => f.endsWith(".jsonl")).map((f) => join(d, f));
          } catch {
            return [];
          }
        })[0]
    : undefined;

  it.skipIf(!realFile)("실제 jsonl을 throw 없이 파싱하고 이벤트를 만든다", () => {
    const text = readFileSync(realFile!, "utf8");
    const events = parseTranscript(text);
    expect(Array.isArray(events)).toBe(true);
    // 최소한 한 줄은 렌더되어야 정상
    expect(events.length).toBeGreaterThan(0);
  });
});
