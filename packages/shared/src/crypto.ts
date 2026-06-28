/**
 * E2EE 봉투 — AES-256-GCM (WebCrypto). 브릿지(Node 20+)·브라우저 공용.
 *
 * 키(e2eeKey, 32B)는 페어링 QR에만 실려 양 끝단만 가짐 → 서버·Supabase는 ciphertext만 본다.
 * 평문 payload(JSON) → encrypt → EncryptedEnvelope{iv, ct} → 채널로 전송.
 * GCM 인증 태그가 ct에 포함되므로 위·변조 시 복호가 throw.
 */
import { EncryptedEnvelopeSchema, type EncryptedEnvelope } from "./messages.js";

const subtle = globalThis.crypto.subtle;
const KEY_BYTES = 32; // AES-256
const IV_BYTES = 12; // GCM 표준 nonce

/** 32바이트 랜덤 키 생성 (브릿지가 페어링 시). */
export function generateKeyBytes(): Uint8Array {
  const b = new Uint8Array(KEY_BYTES);
  globalThis.crypto.getRandomValues(b);
  return b;
}

/** raw 키 바이트 → AES-GCM CryptoKey. */
export async function importKey(raw: Uint8Array): Promise<CryptoKey> {
  if (raw.length !== KEY_BYTES) throw new Error(`키는 ${KEY_BYTES}바이트여야 함 (받음: ${raw.length})`);
  return subtle.importKey("raw", raw as BufferSource, "AES-GCM", false, ["encrypt", "decrypt"]);
}

/** 평문 객체 → 암호화 봉투. */
export async function encrypt(key: CryptoKey, payload: unknown): Promise<EncryptedEnvelope> {
  const iv = globalThis.crypto.getRandomValues(new Uint8Array(IV_BYTES));
  const data = new TextEncoder().encode(JSON.stringify(payload));
  const ct = await subtle.encrypt({ name: "AES-GCM", iv: iv as BufferSource }, key, data as BufferSource);
  return { v: 1, alg: "AES-GCM", iv: b64(iv), ct: b64(new Uint8Array(ct)) };
}

/** 암호화 봉투 → 평문 객체. 위변조·키 불일치 시 throw. */
export async function decrypt<T = unknown>(key: CryptoKey, envelope: EncryptedEnvelope): Promise<T> {
  const env = EncryptedEnvelopeSchema.parse(envelope);
  const buf = await subtle.decrypt(
    { name: "AES-GCM", iv: unb64(env.iv) as BufferSource },
    key,
    unb64(env.ct) as BufferSource,
  );
  return JSON.parse(new TextDecoder().decode(buf)) as T;
}

// --- 키 QR 전송용 base64url ---
export function encodeKey(bytes: Uint8Array): string {
  return b64(bytes).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}
export function decodeKey(s: string): Uint8Array {
  return unb64(s.replace(/-/g, "+").replace(/_/g, "/"));
}

// --- base64 (브라우저/Node 공용, Buffer 미사용) ---
function b64(bytes: Uint8Array): string {
  let s = "";
  for (const byte of bytes) s += String.fromCharCode(byte);
  return btoa(s);
}
function unb64(s: string): Uint8Array {
  const bin = atob(s);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}
