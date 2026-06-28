import { describe, it, expect } from "vitest";
import {
  signPairingWithSecret,
  verifyPairingWithSecret,
  signRealtimeWithSecret,
} from "./jwt-core";
import { decodeJwt } from "jose";

const secretA = new TextEncoder().encode("test-secret-aaaaaaaaaaaaaaaaaaaaaaaa");
const secretB = new TextEncoder().encode("other-secret-bbbbbbbbbbbbbbbbbbbbbbbb");

describe("pairing token", () => {
  it("round-trip: 서명 → 검증 → 같은 namespace", async () => {
    const t = await signPairingWithSecret(secretA, "ns-123");
    expect(await verifyPairingWithSecret(secretA, t)).toBe("ns-123");
  });

  it("다른 secret으로 검증하면 거부 (위조 방지)", async () => {
    const t = await signPairingWithSecret(secretA, "ns-123");
    await expect(verifyPairingWithSecret(secretB, t)).rejects.toThrow();
  });

  it("realtime 토큰을 pairing으로 검증하면 거부 (scope 분리)", async () => {
    const rt = await signRealtimeWithSecret(secretA, "ns-123");
    await expect(verifyPairingWithSecret(secretA, rt)).rejects.toThrow();
  });
});

describe("realtime token (격리 핵심)", () => {
  it("namespace claim + role=authenticated 를 담는다", async () => {
    const rt = await signRealtimeWithSecret(secretA, "ns-xyz");
    const claims = decodeJwt(rt);
    expect(claims.namespace).toBe("ns-xyz");
    expect(claims.role).toBe("authenticated");
    expect(claims.sub).toBe("decku:ns-xyz");
    expect(claims.exp).toBeGreaterThan(claims.iat as number);
  });

  it("서로 다른 namespace는 다른 토큰 (claim이 격리 경계)", async () => {
    const a = decodeJwt(await signRealtimeWithSecret(secretA, "alice"));
    const b = decodeJwt(await signRealtimeWithSecret(secretA, "bob"));
    expect(a.namespace).not.toBe(b.namespace);
  });
});
