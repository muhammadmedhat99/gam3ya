import { describe, expect, it } from "vitest";
import {
  formatAmount,
  formatEGP,
  fromPiasters,
  multiplyAmount,
  parseAmountInput,
  splitPot,
  subtractAmounts,
  sumAmounts,
  toPiasters,
} from "./money";

describe("parseAmountInput", () => {
  it.each([
    ["1000", "1000.00"],
    ["1,000", "1000.00"],
    ["1 000.5", "1000.50"],
    ["٢٥٠", "250.00"],
    ["١٬٠٠٠٫٧٥", "1000.75"],
    ["007", "7.00"],
  ])("%s → %s", (input, expected) => {
    expect(parseAmountInput(input)).toBe(expected);
  });

  it.each(["", "abc", "10.555", "-5", "1e3", "12345678901"])("rejects %s", (input) => {
    expect(parseAmountInput(input)).toBeNull();
  });
});

describe("exact sums", () => {
  it("adds and subtracts in piasters", () => {
    expect(sumAmounts(["750.00", "250.00"])).toBe("1000.00");
    expect(sumAmounts(["0.10", "0.20"])).toBe("0.30");
    expect(subtractAmounts("1000", "750")).toBe("250.00");
    expect(subtractAmounts("1000", "1100")).toBe("-100.00");
    expect(fromPiasters(toPiasters("12.5"))).toBe("12.50");
  });
});

describe("splitPot", () => {
  it("design example: 10 × 1,000 pot, slot 750/250 → 7,500 / 2,500", () => {
    expect(splitPot("10000", "1000", ["750", "250"])).toEqual(["7500.00", "2500.00"]);
  });

  it("puts leftover piasters on the largest share and always sums to the pot", () => {
    // 1000 pot, three equal thirds of a 300 slot → 333.33 each + 0.01 leftover to the first.
    const parts = splitPot("1000", "300", ["100", "100", "100"]);
    expect(parts).toEqual(["333.34", "333.33", "333.33"]);
    expect(sumAmounts(parts)).toBe("1000.00");
  });

  it("a single owner gets the whole pot", () => {
    expect(splitPot("12000", "1000", ["1000"])).toEqual(["12000.00"]);
  });
});

describe("multiplyAmount", () => {
  it("multiplies exactly in piasters", () => {
    expect(multiplyAmount("1000", 10)).toBe("10000.00");
    expect(multiplyAmount("0.10", 3)).toBe("0.30"); // 0.1 * 3 is 0.30000000000000004 in floats
    expect(multiplyAmount("9999999.99", 100)).toBe("999999999.00");
  });
});

describe("formatEGP", () => {
  it("formats like the design", () => {
    expect(formatEGP("1000.00")).toBe("1,000 ج.م");
    expect(formatEGP("10000")).toBe("10,000 ج.م");
    expect(formatEGP("750.5")).toBe("750.50 ج.م");
    expect(formatEGP(7250)).toBe("7,250 ج.م");
  });

  it("uses a real minus sign for reversals", () => {
    expect(formatAmount("-1500.00")).toBe("−1,500");
  });
});
