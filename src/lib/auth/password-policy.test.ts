import { describe, expect, it } from "vitest";
import { checkPasswordPolicy, TEMP_PASSWORD } from "./password-policy";

describe("checkPasswordPolicy", () => {
  it("accepts a reasonable password", () => {
    expect(checkPasswordPolicy("gam3ya-2027!")).toEqual({ ok: true });
  });

  it("rejects short passwords", () => {
    expect(checkPasswordPolicy("abc123")).toMatchObject({ ok: false });
  });

  it("rejects the temporary reset password", () => {
    expect(checkPasswordPolicy(TEMP_PASSWORD)).toMatchObject({ ok: false });
  });

  it("rejects common and repeated-character passwords", () => {
    expect(checkPasswordPolicy("PASSWORD")).toMatchObject({ ok: false });
    expect(checkPasswordPolicy("aaaaaaaaa")).toMatchObject({ ok: false });
  });

  it("rejects passwords over 72 bytes (bcrypt limit)", () => {
    expect(checkPasswordPolicy("ك".repeat(40))).toMatchObject({ ok: false });
  });
});
