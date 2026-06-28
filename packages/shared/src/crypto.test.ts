import { describe, it, expect } from "vitest";
import {
  generateKeyBytes,
  importKey,
  encrypt,
  decrypt,
  encodeKey,
  decodeKey,
} from "./crypto.js";

describe("E2EE 봉투 (AES-256-GCM)", () => {
  it("암호화 → 복호 왕복 (객체 보존)", async () => {
    const key = await importKey(generateKeyBytes());
    const payload = { type: "tx", sessionId: "s1", events: [{ kind: "title", title: "안녕 🌍" }] };
    const env = await encrypt(key, payload);
    expect(await decrypt(key, env)).toEqual(payload);
  });

  it("봉투는 평문을 노출하지 않는다 (ciphertext)", async () => {
    const key = await importKey(generateKeyBytes());
    const env = await encrypt(key, { secret: "비밀문장" });
    expect(env.alg).toBe("AES-GCM");
    expect(env.v).toBe(1);
    // base64 ct/iv 어디에도 평문 흔적 없음
    expect(env.ct).not.toContain("비밀");
    expect(`${env.iv}${env.ct}`).not.toMatch(/secret|비밀문장/);
  });

  it("다른 키로 복호하면 실패 (벤더가 못 읽음)", async () => {
    const keyA = await importKey(generateKeyBytes());
    const keyB = await importKey(generateKeyBytes());
    const env = await encrypt(keyA, { x: 1 });
    await expect(decrypt(keyB, env)).rejects.toThrow();
  });

  it("ct 위변조 시 복호 실패 (GCM 인증)", async () => {
    const key = await importKey(generateKeyBytes());
    const env = await encrypt(key, { x: 1 });
    const tampered = { ...env, ct: flipLast(env.ct) };
    await expect(decrypt(key, tampered)).rejects.toThrow();
  });

  it("매번 다른 iv → 같은 평문도 다른 ct (nonce 재사용 방지)", async () => {
    const key = await importKey(generateKeyBytes());
    const a = await encrypt(key, { same: true });
    const b = await encrypt(key, { same: true });
    expect(a.iv).not.toBe(b.iv);
    expect(a.ct).not.toBe(b.ct);
  });

  it("키 길이가 32B 아니면 거부", async () => {
    await expect(importKey(new Uint8Array(16))).rejects.toThrow();
  });
});

describe("키 QR 인코딩 (base64url)", () => {
  it("encodeKey → decodeKey 왕복", () => {
    const k = generateKeyBytes();
    expect(decodeKey(encodeKey(k))).toEqual(k);
  });
  it("URL 안전 문자만 (+/= 없음)", () => {
    const s = encodeKey(generateKeyBytes());
    expect(s).not.toMatch(/[+/=]/);
  });
});

function flipLast(b64: string): string {
  const c = b64.at(-2) === "A" ? "B" : "A"; // 패딩 앞 글자 한 자 바꿈
  return b64.slice(0, -2) + c + b64.slice(-1);
}
