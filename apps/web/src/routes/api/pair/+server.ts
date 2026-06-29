/**
 * POST /api/pair
 *
 * 새 namespace 발급(자격증명 = 이 랜덤값) + 브릿지가 Supabase에 직접 붙는 공개값 반환.
 * (e2eeKey는 여기 절대 안 옴 — 브릿지 로컬에서만 생성. pairing 토큰 없음 → QR 짧아짐.)
 */
import { json } from "@sveltejs/kit";
import { env } from "$env/dynamic/public";
import type { RequestHandler } from "./$types";
import { newNamespace } from "$lib/server/namespace";
import { signPairingToken } from "$lib/server/jwt";

export const POST: RequestHandler = async ({ request }) => {
  const body = (await request.json().catch(() => null)) as { expireDays?: number } | null;
  const namespace = newNamespace();
  const res: Record<string, unknown> = {
    namespace,
    supabaseUrl: env.PUBLIC_SUPABASE_URL,
    supabaseAnonKey: env.PUBLIC_SUPABASE_ANON_KEY,
  };
  // expireDays 지정 시에만 만료 토큰 발급(opt-in). 미지정=무제한(기존 동작).
  const days = body?.expireDays;
  if (typeof days === "number" && days > 0) {
    res.pairingToken = await signPairingToken(namespace, days);
  }
  return json(res);
};
