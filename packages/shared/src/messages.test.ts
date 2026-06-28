import { describe, it, expect } from "vitest";
import {
  EncryptedEnvelopeSchema,
  SessionsPayloadSchema,
  TxPayloadSchema,
  CmdPayloadSchema,
} from "./messages.js";

describe("EncryptedEnvelope", () => {
  it("유효한 봉투 통과", () => {
    expect(() =>
      EncryptedEnvelopeSchema.parse({ v: 1, alg: "AES-GCM", iv: "aXY=", ct: "Y3Q=" }),
    ).not.toThrow();
  });
  it("버전/알고리즘 불일치 거부", () => {
    expect(() => EncryptedEnvelopeSchema.parse({ v: 2, alg: "AES-GCM", iv: "x", ct: "y" })).toThrow();
    expect(() => EncryptedEnvelopeSchema.parse({ v: 1, alg: "RSA", iv: "x", ct: "y" })).toThrow();
  });
});

describe("payload 스키마", () => {
  it("SessionsPayload", () => {
    const p = {
      type: "sessions",
      items: [{ sessionId: "s1", pid: 123, cwd: "/x", live: true }],
    };
    expect(SessionsPayloadSchema.parse(p)).toMatchObject({ type: "sessions" });
  });

  it("TxPayload (backfill 청크)", () => {
    const p = {
      type: "tx",
      sessionId: "s1",
      seq: 0,
      done: false,
      events: [{ kind: "message", role: "user", blocks: [{ type: "text", text: "hi" }] }],
    };
    expect(TxPayloadSchema.parse(p)).toMatchObject({ sessionId: "s1", seq: 0 });
  });

  it("CmdPayload send / load 판별", () => {
    expect(CmdPayloadSchema.parse({ op: "send", sessionId: "s1", text: "hi" })).toMatchObject({ op: "send" });
    expect(CmdPayloadSchema.parse({ op: "load", sessionId: "s1" })).toMatchObject({ op: "load" });
  });

  it("CmdPayload send 는 text 필수", () => {
    expect(() => CmdPayloadSchema.parse({ op: "send", sessionId: "s1" })).toThrow();
  });
});
