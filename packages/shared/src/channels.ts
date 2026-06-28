/**
 * 테넌트 네임스페이스 채널명 빌더.
 *
 * 격리의 보안 경계. 모든 채널은 `tenant:<userId>:...` 로 시작하고,
 * Realtime Authorization(RLS)이 토큰의 userId와 topic의 userId 일치를 강제한다.
 * 여기서 규칙이 새면 테넌트 간 대화가 유출된다.
 */

export function sessionsChannel(userId: string): string {
  return `tenant:${userId}:sessions`;
}

export function txChannel(userId: string, sessionId: string): string {
  return `tenant:${userId}:tx:${sessionId}`;
}

export function cmdChannel(userId: string): string {
  return `tenant:${userId}:cmd`;
}

/** 채널명에서 userId 추출 (RLS 정책 검증/테스트용). 형식이 안 맞으면 null. */
export function tenantOf(channel: string): string | null {
  const m = /^tenant:([^:]+):/.exec(channel);
  return m ? (m[1] ?? null) : null;
}
