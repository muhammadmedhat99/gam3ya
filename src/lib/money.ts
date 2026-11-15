/**
 * EGP amounts as decimal strings ("1000", "1000.5", "750.00"), never floats.
 * Arithmetic on money happens in Postgres (numeric); here we only parse and format.
 */

const AMOUNT_RE = /^(\d{1,10})(?:\.(\d{1,2}))?$/;

/** User input → canonical "1234.50", or null. Accepts Arabic digits, commas and spaces. */
export function parseAmountInput(input: string): string | null {
  const s = input
    .replace(/[٠-٩]/g, (d) => String(d.charCodeAt(0) - 0x0660))
    .replace(/[۰-۹]/g, (d) => String(d.charCodeAt(0) - 0x06f0))
    .replace(/[٫]/g, ".")
    .replace(/[\s,٬]/g, "");
  const m = AMOUNT_RE.exec(s);
  if (!m) return null;
  const whole = m[1].replace(/^0+(?=\d)/, "");
  const fraction = (m[2] ?? "").padEnd(2, "0");
  return `${whole}.${fraction}`;
}

function groupThousands(whole: string): string {
  return whole.replace(/\B(?=(\d{3})+(?!\d))/g, ",");
}

/** "1000.00" → "1,000"; "750.5" → "750.50". Without the currency. */
export function formatAmount(amount: string | number): string {
  const [whole, fraction = ""] = String(amount).split(".");
  const sign = whole.startsWith("-") ? "−" : "";
  const digits = groupThousands(whole.replace("-", ""));
  const cents = fraction.padEnd(2, "0").slice(0, 2);
  return cents === "00" ? `${sign}${digits}` : `${sign}${digits}.${cents}`;
}

/** "1000.50" → 100050n. Invalid input → 0n. */
export function toPiasters(amount: string): bigint {
  const canonical = parseAmountInput(amount);
  return canonical ? BigInt(canonical.replace(".", "")) : 0n;
}

/** 100050n → "1000.50" (supports negatives). */
export function fromPiasters(piasters: bigint): string {
  const negative = piasters < 0n;
  const s = (negative ? -piasters : piasters).toString().padStart(3, "0");
  return `${negative ? "-" : ""}${s.slice(0, -2)}.${s.slice(-2)}`;
}

/** Exact sum of decimal strings. */
export function sumAmounts(amounts: string[]): string {
  return fromPiasters(amounts.reduce((acc, a) => acc + toPiasters(a), 0n));
}

/** Exact a − b (may be negative). */
export function subtractAmounts(a: string, b: string): string {
  return fromPiasters(toPiasters(a) - toPiasters(b));
}

/**
 * Split a cycle's pot among a slot's owners by share (BUSINESS_RULES.md §8):
 * each gets pot × allocation / slotAmount rounded down to the piaster, and the
 * leftover piasters go to the largest allocation (ties: the first one listed,
 * i.e. the earliest created). The result always sums to the pot exactly.
 */
export function splitPot(pot: string, slotAmount: string, allocations: string[]): string[] {
  const potP = toPiasters(pot);
  const slotP = toPiasters(slotAmount);
  if (slotP === 0n || allocations.length === 0) return allocations.map(() => "0.00");
  const shares = allocations.map((a) => (potP * toPiasters(a)) / slotP);
  const leftover = potP - shares.reduce((acc, s) => acc + s, 0n);
  let largest = 0;
  allocations.forEach((a, i) => {
    if (toPiasters(a) > toPiasters(allocations[largest])) largest = i;
  });
  shares[largest] += leftover;
  return shares.map(fromPiasters);
}

/** amount × count in piasters (BigInt), for display totals like "10,000 ج.م". */
export function multiplyAmount(amount: string, count: number): string {
  const canonical = parseAmountInput(amount);
  if (!canonical || !Number.isInteger(count) || count < 0) return "0.00";
  const piasters = BigInt(canonical.replace(".", "")) * BigInt(count);
  const s = piasters.toString().padStart(3, "0");
  return `${s.slice(0, -2)}.${s.slice(-2)}`;
}

/** "1000.00" → "1,000 ج.م" (design: Western digits, currency after the number). */
export function formatEGP(amount: string | number): string {
  return `${formatAmount(amount)} ج.م`;
}
