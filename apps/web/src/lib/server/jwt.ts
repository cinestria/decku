/**
 * JWT env 래퍼 — secret을 SUPABASE_JWT_SECRET에서 읽어 코어에 넘김.
 * secret은 서버(Vercel) env에만. 브라우저/브릿지엔 발급된 토큰만 내려감.
 */
import { env } from "$env/dynamic/private";
import {
  signPairingWithSecret,
  verifyPairingWithSecret,
  signRealtimeWithSecret,
} from "./jwt-core";

function secret(): Uint8Array {
  const s = env.SUPABASE_JWT_SECRET;
  if (!s) throw new Error("SUPABASE_JWT_SECRET 미설정 (apps/web/.env)");
  return new TextEncoder().encode(s);
}

export const signPairingToken = (namespace: string) => signPairingWithSecret(secret(), namespace);
export const verifyPairingToken = (token: string) => verifyPairingWithSecret(secret(), token);
export const signRealtimeToken = (namespace: string) => signRealtimeWithSecret(secret(), namespace);
