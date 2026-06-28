/**
 * POST /api/pair
 *
 * 새 namespace + pairingToken 발급. 로그인 없음.
 * 브릿지가 첫 `pair`에서 호출 → 받은 namespace/pairingToken + 로컬 생성 e2eeKey로 QR 구성.
 * (e2eeKey는 여기 절대 안 옴 — 브릿지 로컬에서만 생성.)
 */
import { json } from "@sveltejs/kit";
import type { RequestHandler } from "./$types";
import { newNamespace } from "$lib/server/namespace";
import { signPairingToken } from "$lib/server/jwt";

export const POST: RequestHandler = async () => {
  const namespace = newNamespace();
  const pairingToken = await signPairingToken(namespace);
  return json({ namespace, pairingToken });
};
