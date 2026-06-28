import { describe, it, expect } from "vitest";
import { signRealtimeWithSecret, isValidNamespace } from "./jwt-core";
import { decodeJwt } from "jose";

const secretA = new TextEncoder().encode("test-secret-aaaaaaaaaaaaaaaaaaaaaaaa");

describe("realtime token (격리 핵심)", () => {
  it("namespace claim + role=authenticated 를 담는다", async () => {
    const rt = await signRealtimeWithSecret(secretA, "ns-xyz12345");
    const claims = decodeJwt(rt);
    expect(claims.namespace).toBe("ns-xyz12345");
    expect(claims.role).toBe("authenticated");
    expect(claims.sub).toBe("decku:ns-xyz12345");
    expect(claims.exp).toBeGreaterThan(claims.iat as number);
  });

  it("서로 다른 namespace는 다른 claim (격리 경계)", async () => {
    const a = decodeJwt(await signRealtimeWithSecret(secretA, "aliceaaaaaaaaaaa"));
    const b = decodeJwt(await signRealtimeWithSecret(secretA, "bobbbbbbbbbbbbbbb"));
    expect(a.namespace).not.toBe(b.namespace);
  });
});

describe("isValidNamespace", () => {
  it("base64url 16~64자만 통과", () => {
    expect(isValidNamespace("sSjMV1548iFQLwuNbPkNpu46")).toBe(true);
    expect(isValidNamespace("short")).toBe(false);
    expect(isValidNamespace("has space and!@#")).toBe(false);
    expect(isValidNamespace(123)).toBe(false);
    expect(isValidNamespace(undefined)).toBe(false);
  });
});
