/**
 * JWT 코어 — secret을 인자로 받는 순수 함수. env 의존 없음 → 단위 테스트 가능.
 * env 래퍼는 ./jwt.ts.
 *
 * 자격증명 = namespace(144bit 랜덤). realtime 토큰만 서명한다(별도 pairing 토큰 없음).
 * namespace는 추측 불가한 비밀이고, RLS가 namespace로 격리하므로 별도 서명 게이트 불필요.
 */
import { SignJWT } from "jose";

const REALTIME_TTL = "1h";

/** Supabase Realtime 연결용 단명 토큰. role:authenticated + namespace claim. */
export async function signRealtimeWithSecret(secret: Uint8Array, namespace: string): Promise<string> {
  return new SignJWT({ namespace, role: "authenticated" })
    .setProtectedHeader({ alg: "HS256" })
    .setSubject(`decku:${namespace}`)
    .setIssuedAt()
    .setExpirationTime(REALTIME_TTL)
    .sign(secret);
}

/** namespace 형식 검증 (base64url, 16~64자). 토큰 발급 전 가벼운 게이트. */
export function isValidNamespace(ns: unknown): ns is string {
  return typeof ns === "string" && /^[A-Za-z0-9_-]{16,64}$/.test(ns);
}
