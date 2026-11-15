/**
 * Egyptian mobile numbers only for the MVP: 010, 011, 012, 015 + 8 digits.
 * Returns E.164 (+201XXXXXXXXX) or null when the input isn't a valid number.
 * Accepts local (01…), international (+20…, 0020…), missing leading zero,
 * spaces/dashes/brackets, and Arabic-Indic or Persian digits.
 */
export function normalizeEgyptPhone(input: string): string | null {
  let s = input
    .replace(/[٠-٩]/g, (d) => String(d.charCodeAt(0) - 0x0660))
    .replace(/[۰-۹]/g, (d) => String(d.charCodeAt(0) - 0x06f0))
    .replace(/[\s\-().‎‏]/g, "");

  if (s.startsWith("+")) s = s.slice(1);
  else if (s.startsWith("00")) s = s.slice(2);
  else if (s.startsWith("0")) s = `20${s.slice(1)}`;
  else if (/^1[0125]\d{8}$/.test(s)) s = `20${s}`;

  return /^201[0125]\d{8}$/.test(s) ? `+${s}` : null;
}

/** +201012345678 → "010 1234 5678" (Western digits, for display). */
export function formatEgyptPhone(e164: string): string {
  const m = /^\+20(1\d)(\d{4})(\d{4})$/.exec(e164);
  return m ? `0${m[1]} ${m[2]} ${m[3]}` : e164;
}
