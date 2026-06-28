/**
 * POST /api/pair
 *
 * 새 namespace + pairingToken 발급 (로그인 없음) + 브릿지가 Supabase에 직접 붙는 데 필요한
 * 공개값(supabaseUrl/anonKey)도 같이 반환 → 브릿지는 웹앱 URL 하나만 알면 자기설정됨.
 * (e2eeKey는 여기 절대 안 옴 — 브릿지 로컬에서만 생성.)
 */
import { json } from "@sveltejs/kit";
import { env } from "$env/dynamic/public";
import type { RequestHandler } from "./$types";
import { newNamespace } from "$lib/server/namespace";
import { signPairingToken } from "$lib/server/jwt";

export const POST: RequestHandler = async () => {
  const namespace = newNamespace();
  const pairingToken = await signPairingToken(namespace);
  return json({
    namespace,
    pairingToken,
    supabaseUrl: env.PUBLIC_SUPABASE_URL,
    supabaseAnonKey: env.PUBLIC_SUPABASE_ANON_KEY,
  });
};
