import { describe, expect, it } from "vitest";
import { changePasswordSchema, loginSchema, registerSchema } from "./auth";

describe("registerSchema", () => {
  it("normalizes the phone and trims the name", () => {
    const out = registerSchema.parse({
      fullName: "  منى أحمد ",
      phone: "010 1234 5678",
      password: "gam3ya-2027!",
      confirmPassword: "gam3ya-2027!",
    });
    expect(out).toMatchObject({ fullName: "منى أحمد", phone: "+201012345678" });
  });

  it("rejects mismatched confirmation", () => {
    const r = registerSchema.safeParse({
      fullName: "منى",
      phone: "01012345678",
      password: "gam3ya-2027!",
      confirmPassword: "other-pass-1",
    });
    expect(r.success).toBe(false);
    expect(r.error?.issues[0].path).toEqual(["confirmPassword"]);
  });

  it("rejects the temporary password", () => {
    const r = registerSchema.safeParse({
      fullName: "منى",
      phone: "01012345678",
      password: "123456789",
      confirmPassword: "123456789",
    });
    expect(r.success).toBe(false);
  });
});

describe("loginSchema", () => {
  it("rejects an invalid phone", () => {
    expect(loginSchema.safeParse({ phone: "123", password: "x" }).success).toBe(false);
  });
});

describe("changePasswordSchema", () => {
  it("rejects reusing the current password", () => {
    const r = changePasswordSchema.safeParse({
      currentPassword: "gam3ya-2027!",
      newPassword: "gam3ya-2027!",
      confirmPassword: "gam3ya-2027!",
    });
    expect(r.success).toBe(false);
  });

  it("allows omitting the current password (forced change flow)", () => {
    const r = changePasswordSchema.safeParse({
      newPassword: "gam3ya-2027!",
      confirmPassword: "gam3ya-2027!",
    });
    expect(r.success).toBe(true);
  });
});
