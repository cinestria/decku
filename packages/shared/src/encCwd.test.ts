import { describe, it, expect } from "vitest";
import { encCwd } from "./encCwd.js";

describe("encCwd", () => {
  it("문서 예시: /·. 를 - 로 치환", () => {
    expect(encCwd("/Users/shiregold/Data/Work/vibe-quant")).toBe(
      "-Users-shiregold-Data-Work-vibe-quant",
    );
  });

  it("점(.)도 치환", () => {
    expect(encCwd("/Users/me/proj.v2")).toBe("-Users-me-proj-v2");
  });

  it("worktree 경로처럼 점이 많아도", () => {
    expect(encCwd("/a/b/.claude-worktrees/x.y")).toBe("-a-b--claude-worktrees-x-y");
  });
});
