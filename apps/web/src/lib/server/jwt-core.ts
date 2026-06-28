/**
 * JWT 코어 — secret을 인자로 받는 순수 함수. env 의존 없음 → 단위 테스트 가능.
 * env 래퍼는 ./jwt.ts.
 */
import { SignJWT, jwtVerify } from "jose";

const PAIRING_TTL = "365d"; // 기기 페어링은 장수명 — 연속성. (e2eeKey가 실제 비밀, --new로 회전)
const REALTIME_TTL = "1h"; // 단명, 브라우저가 주기적으로 갱신

export async function signPairingWithSecret(secret: Uint8Array, namespace: string): Promise<string> {
  return new SignJWT({ namespace, scope: "pair" })
    .setProtectedHeader({ alg: "HS256" })
    .setIssuedAt()
    .setExpirationTime(PAIRING_TTL)
    .sign(secret);
}

/** pairingToken 검증 → namespace. 서명/scope/namespace 불일치 시 throw. */
export async function verifyPairingWithSecret(secret: Uint8Array, token: string): Promise<string> {
  const { payload } = await jwtVerify(token, secret);
  if (payload.scope !== "pair" || typeof payload.namespace !== "string" || !payload.namespace) {
    throw new Error("invalid pairing token");
  }
  return payload.namespace;
}

/** Supabase Realtime 연결용 단명 토큰. role:authenticated + namespace claim. */
export async function signRealtimeWithSecret(secret: Uint8Array, namespace: string): Promise<string> {
  return new SignJWT({ namespace, role: "authenticated" })
    .setProtectedHeader({ alg: "HS256" })
    .setSubject(`decku:${namespace}`)
    .setIssuedAt()
    .setExpirationTime(REALTIME_TTL)
    .sign(secret);
}
