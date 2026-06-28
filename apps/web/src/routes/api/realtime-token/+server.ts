/**
 * POST /api/realtime-token   body: { pairingToken }
 *
 * pairingToken 검증 → 그 namespace로만 scoped된 단명 realtime 토큰 발급.
 * 브릿지·브라우저 둘 다 이 엔드포인트로 토큰을 갱신.
 */
import { json, error } from "@sveltejs/kit";
import type { RequestHandler } from "./$types";
import { verifyPairingToken, signRealtimeToken } from "$lib/server/jwt";

export const POST: RequestHandler = async ({ request }) => {
  const body = (await request.json().catch(() => null)) as { pairingToken?: string } | null;
  const pairingToken = body?.pairingToken;
  if (!pairingToken) throw error(400, "pairingToken required");

  let namespace: string;
  try {
    namespace = await verifyPairingToken(pairingToken);
  } catch {
    throw error(401, "invalid pairing token");
  }

  const token = await signRealtimeToken(namespace);
  return json({ token, namespace });
};
