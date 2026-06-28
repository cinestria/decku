import { z } from "zod";

/**
 * 세션 레지스트리 파일 `~/.claude/sessions/<pid>.json` 한 개.
 * 떠 있는 Claude Desktop 세션마다 한 파일. 라이브 여부는 pid 생존으로 판단.
 */
export const SessionFileSchema = z.object({
  pid: z.number(),
  sessionId: z.string(),
  cwd: z.string(),
  startedAt: z.number().optional(),
  version: z.string().optional(),
  kind: z.string().optional(),
  entrypoint: z.string().optional(),
  // 실측에서 본 추가 필드 (없을 수도 있음)
  procStart: z.string().optional(),
  peerProtocol: z.number().optional(),
});
export type SessionFile = z.infer<typeof SessionFileSchema>;

/**
 * 브라우저로 publish하는 세션 목록 항목 (민감 본문 제외, 표시에 필요한 것만).
 * cwd·title은 E2EE 페이로드 안에 담겨 암호화되므로 여기 평문 필드는 publish 전 봉투로 감싼다.
 */
export const SessionListItemSchema = z.object({
  sessionId: z.string(),
  pid: z.number(),
  cwd: z.string(),
  title: z.string().optional(),
  startedAt: z.number().optional(),
  live: z.boolean(),
});
export type SessionListItem = z.infer<typeof SessionListItemSchema>;
