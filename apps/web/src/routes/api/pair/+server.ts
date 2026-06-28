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

export const POST: RequestHandler = async () => {
  return json({
    namespace: newNamespace(),
    supabaseUrl: env.PUBLIC_SUPABASE_URL,
    supabaseAnonKey: env.PUBLIC_SUPABASE_ANON_KEY,
  });
};
