/**
 * Claude Desktop transcript 디렉터리명 인코딩.
 *
 * `~/.claude/projects/<enc-cwd>/<sessionId>.jsonl` 에서 `enc-cwd`는
 * cwd의 `/` 와 `.` 를 모두 `-` 로 치환한 것.
 *
 *   /Users/shiregold/Data/Work/vibe-quant
 *     → -Users-shiregold-Data-Work-vibe-quant
 *
 * 주의: 손실 변환이다(`-`/`/`/`.` 구분 불가) → 역변환 불가. 디렉터리 매칭 용도로만.
 */
export function encCwd(cwd: string): string {
  return cwd.replace(/[/.]/g, "-");
}
