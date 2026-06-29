/**
 * Transcript jsonl 파서.
 *
 * `~/.claude/projects/<enc-cwd>/<sessionId>.jsonl` 는 append-only JSONL.
 * 한 줄 = 한 이벤트. 우리가 렌더하는 줄: user / assistant / ai-title.
 * (attachment / system / queue-operation / last-prompt 는 무시 → null 반환.)
 *
 * 파싱은 방어적으로: append 도중 잘린 줄·미지 형식은 throw 없이 null.
 */

export type ContentBlock =
  | { type: "text"; text: string }
  | { type: "thinking"; text: string }
  | { type: "tool_use"; name: string; id?: string; summary?: string }
  | { type: "tool_result"; text: string }
  | { type: "image" }
  | { type: "unknown"; raw: string };

export type RenderEvent =
  | {
      kind: "message";
      role: "user" | "assistant";
      blocks: ContentBlock[];
      uuid?: string;
      timestamp?: string;
    }
  | { kind: "title"; title: string; sessionId?: string };

/** tool_use.input → 한 줄 요약(파일명·명령어 등). 데스크탑 앱처럼 "Edit README.md" 식으로 보여주려고. */
function summarizeToolInput(name: string, input: unknown): string | undefined {
  if (!input || typeof input !== "object") return undefined;
  const i = input as Record<string, unknown>;
  const base = (p: unknown): string | undefined =>
    typeof p === "string" && p ? (p.split("/").filter(Boolean).pop() ?? p) : undefined;
  const trunc = (s: unknown, n: number): string | undefined =>
    typeof s === "string" && s ? (s.length > n ? s.slice(0, n) + "…" : s) : undefined;
  switch (name) {
    case "Read":
    case "Edit":
    case "MultiEdit":
    case "Write":
    case "NotebookEdit":
      return base(i["file_path"] ?? i["path"] ?? i["notebook_path"]);
    case "Bash":
      return trunc(typeof i["command"] === "string" ? i["command"].replace(/\s+/g, " ").trim() : undefined, 60);
    case "Grep":
    case "Glob":
      return trunc(i["pattern"], 40);
    case "Task":
      return trunc(i["description"] ?? i["subagent_type"], 40);
    case "WebFetch":
      return trunc(i["url"], 50);
    case "WebSearch":
      return trunc(i["query"], 50);
    default:
      return base(i["file_path"]); // 알 수 없는 툴도 file_path 있으면 표시
  }
}

/** message.content (string | block[]) 를 ContentBlock[] 로 정규화. */
function normalizeContent(content: unknown): ContentBlock[] {
  if (typeof content === "string") {
    return content ? [{ type: "text", text: content }] : [];
  }
  if (!Array.isArray(content)) return [];

  const out: ContentBlock[] = [];
  for (const block of content) {
    if (block == null || typeof block !== "object") continue;
    const b = block as Record<string, unknown>;
    switch (b["type"]) {
      case "text":
        out.push({ type: "text", text: String(b["text"] ?? "") });
        break;
      case "thinking":
        out.push({ type: "thinking", text: String(b["thinking"] ?? b["text"] ?? "") });
        break;
      case "tool_use": {
        const name = String(b["name"] ?? "tool");
        const summary = summarizeToolInput(name, b["input"]);
        out.push({
          type: "tool_use",
          name,
          ...(typeof b["id"] === "string" ? { id: b["id"] } : {}),
          ...(summary ? { summary } : {}),
        });
        break;
      }
      case "tool_result": {
        // tool_result.content 도 string | block[] 일 수 있음
        const c = b["content"];
        const text =
          typeof c === "string"
            ? c
            : Array.isArray(c)
              ? c
                  .map((x) =>
                    x && typeof x === "object" && (x as any).type === "text"
                      ? String((x as any).text ?? "")
                      : "",
                  )
                  .join("")
              : "";
        out.push({ type: "tool_result", text });
        break;
      }
      case "image":
        out.push({ type: "image" });
        break;
      default:
        out.push({ type: "unknown", raw: JSON.stringify(block) });
    }
  }
  return out;
}

/** jsonl 한 줄 → RenderEvent | null (렌더 대상 아니거나 파싱 실패 시 null). */
export function parseTranscriptLine(line: string): RenderEvent | null {
  const trimmed = line.trim();
  if (!trimmed) return null;

  let rec: Record<string, unknown>;
  try {
    rec = JSON.parse(trimmed);
  } catch {
    return null; // append 도중 잘린 줄
  }

  switch (rec["type"]) {
    case "ai-title":
      return {
        kind: "title",
        title: String(rec["aiTitle"] ?? ""),
        ...(typeof rec["sessionId"] === "string" ? { sessionId: rec["sessionId"] } : {}),
      };
    case "user":
    case "assistant": {
      const message = rec["message"] as Record<string, unknown> | undefined;
      if (!message) return null;
      const blocks = normalizeContent(message["content"]);
      if (blocks.length === 0) return null;
      return {
        kind: "message",
        role: rec["type"] as "user" | "assistant",
        blocks,
        ...(typeof rec["uuid"] === "string" ? { uuid: rec["uuid"] } : {}),
        ...(typeof rec["timestamp"] === "string" ? { timestamp: rec["timestamp"] } : {}),
      };
    }
    default:
      return null;
  }
}

/** 여러 줄(파일 통째 또는 청크) → RenderEvent[]. null 은 걸러진다. */
export function parseTranscript(text: string): RenderEvent[] {
  const out: RenderEvent[] = [];
  for (const line of text.split("\n")) {
    const ev = parseTranscriptLine(line);
    if (ev) out.push(ev);
  }
  return out;
}
