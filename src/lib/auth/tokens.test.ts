import { describe, expect, it } from "vitest";
import { generateSessionToken, hashIp, hashSessionToken } from "./tokens";

describe("session tokens", () => {
  it("generates unique 256-bit base64url tokens", () => {
    const a = generateSessionToken();
    const b = generateSessionToken();
    expect(a).not.toBe(b);
    expect(a).toMatch(/^[A-Za-z0-9_-]{43}$/);
  });

  it("hashes deterministically and never returns the token itself", () => {
    const token = generateSessionToken();
    expect(hashSessionToken(token)).toBe(hashSessionToken(token));
    expect(hashSessionToken(token)).not.toContain(token);
    expect(hashSessionToken(token)).toMatch(/^[0-9a-f]{64}$/);
  });

  it("keys IP hashes", () => {
    expect(hashIp("1.2.3.4", "k1")).not.toBe(hashIp("1.2.3.4", "k2"));
  });
});
