import { describe, it, expect } from "vitest";
import { sessionsChannel, txChannel, cmdChannel, tenantOf } from "./channels.js";

describe("채널명 빌더 (테넌트 격리 경계)", () => {
  const uid = "user-123";

  it("sessions / cmd 채널", () => {
    expect(sessionsChannel(uid)).toBe("tenant:user-123:sessions");
    expect(cmdChannel(uid)).toBe("tenant:user-123:cmd");
  });

  it("tx 채널은 sessionId 포함", () => {
    expect(txChannel(uid, "abc-def")).toBe("tenant:user-123:tx:abc-def");
  });

  it("tenantOf 는 모든 채널에서 userId 복원", () => {
    expect(tenantOf(sessionsChannel(uid))).toBe(uid);
    expect(tenantOf(cmdChannel(uid))).toBe(uid);
    expect(tenantOf(txChannel(uid, "s1"))).toBe(uid);
  });

  it("tenantOf 는 형식 불일치 시 null", () => {
    expect(tenantOf("random-channel")).toBeNull();
    expect(tenantOf("tenant:")).toBeNull();
  });

  it("다른 유저 채널은 tenantOf 가 구분", () => {
    expect(tenantOf(sessionsChannel("alice"))).not.toBe(tenantOf(sessionsChannel("bob")));
  });
});
