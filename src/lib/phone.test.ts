import { describe, expect, it } from "vitest";
import { formatEgyptPhone, normalizeEgyptPhone } from "./phone";

describe("normalizeEgyptPhone", () => {
  it.each([
    ["01012345678", "+201012345678"],
    ["010 1234 5678", "+201012345678"],
    ["010-1234-5678", "+201012345678"],
    ["+201112345678", "+201112345678"],
    ["00201212345678", "+201212345678"],
    ["1512345678", "+201512345678"],
    ["٠١٠١٢٣٤٥٦٧٨", "+201012345678"],
    ["۰۱۰۱۲۳۴۵۶۷۸", "+201012345678"],
  ])("%s → %s", (input, expected) => {
    expect(normalizeEgyptPhone(input)).toBe(expected);
  });

  it.each(["", "0101234567", "010123456789", "01312345678", "0221234567", "+966512345678", "abc"])(
    "rejects %s",
    (input) => {
      expect(normalizeEgyptPhone(input)).toBeNull();
    },
  );
});

describe("formatEgyptPhone", () => {
  it("formats E.164 for display", () => {
    expect(formatEgyptPhone("+201012345678")).toBe("010 1234 5678");
  });
});
