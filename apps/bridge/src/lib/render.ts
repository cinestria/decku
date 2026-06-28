/**
 * RenderEvent → 콘솔 문자열 (M1 로컬 검증용).
 */
import type { RenderEvent, ContentBlock } from "@decku/shared";

const DIM = "\x1b[2m";
const BOLD = "\x1b[1m";
const RESET = "\x1b[0m";
const CYAN = "\x1b[36m";
const GREEN = "\x1b[32m";
const YELLOW = "\x1b[33m";

function blockToText(b: ContentBlock): string {
  switch (b.type) {
    case "text":
      return b.text;
    case "thinking":
      return `${DIM}(thinking) ${b.text}${RESET}`;
    case "tool_use":
      return `${YELLOW}⚙ ${b.name}${RESET}`;
    case "tool_result":
      return `${DIM}↳ ${b.text.slice(0, 200)}${RESET}`;
    case "image":
      return `${DIM}[image]${RESET}`;
    case "unknown":
      return `${DIM}[?]${RESET}`;
  }
}

/** 한 이벤트를 콘솔 한 덩이로. label은 멀티세션 구분용 prefix. */
export function renderEvent(ev: RenderEvent, label?: string): string {
  const tag = label ? `${DIM}[${label}]${RESET} ` : "";
  if (ev.kind === "title") {
    return `${tag}${BOLD}⭐ ${ev.title}${RESET}`;
  }
  const who =
    ev.role === "user" ? `${CYAN}${BOLD}user${RESET}` : `${GREEN}${BOLD}assistant${RESET}`;
  const body = ev.blocks.map(blockToText).join("\n");
  return `${tag}${who}: ${body}`;
}
