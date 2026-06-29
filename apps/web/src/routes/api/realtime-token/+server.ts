/**
 * POST /api/realtime-token   body: { namespace }
 *
 * namespace(랜덤 자격증명)에 대해 그 namespace로만 scoped된 단명 realtime 토큰 발급.
 * namespace는 추측 불가 + RLS가 격리하므로 별도 서명 검증 없이 발급(rate limit은 후순위).
 */
import { json, error } from "@sveltejs/kit";
import type { RequestHandler } from "./$types";
import { signRealtimeToken, isValidNamespace, verifyPairingToken } from "$lib/server/jwt";

export const POST: RequestHandler = async ({ request }) => {
  const body = (await request.json().catch(() => null)) as
    | { namespace?: string; pairingToken?: string }
    | null;

  // 만료 토큰이 있으면 그게 namespace를 규정 + 만료 검사 (opt-in 페어링).
  let namespace = body?.namespace;
  if (body?.pairingToken) {
    const ns = await verifyPairingToken(body.pairingToken);
    if (!ns) throw error(403, "pairing expired or invalid");
    namespace = ns;
  }
  if (!isValidNamespace(namespace)) throw error(400, "valid namespace required");

  const token = await signRealtimeToken(namespace);
  return json({ token, namespace });
};
