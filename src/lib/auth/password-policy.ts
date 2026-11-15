/** Client-safe password rules. Hashing lives in ./password.ts (server-only). */

export const PASSWORD_MIN_LENGTH = 8;
/** bcrypt ignores bytes after 72. */
export const PASSWORD_MAX_BYTES = 72;
/** Temporary password set by a super-admin reset (see AGENTS.md section 4). */
export const TEMP_PASSWORD = "123456789";

const COMMON_PASSWORDS = new Set([
  TEMP_PASSWORD,
  "12345678",
  "1234567890",
  "123123123",
  "11111111",
  "00000000",
  "12341234",
  "87654321",
  "password",
  "password1",
  "qwertyui",
  "qwerty123",
  "iloveyou",
  "abcd1234",
  "a1234567",
]);

export type PasswordPolicyResult = { ok: true } | { ok: false; message: string };

export function checkPasswordPolicy(password: string): PasswordPolicyResult {
  if (password.length < PASSWORD_MIN_LENGTH) {
    return { ok: false, message: `كلمة السر لازم تكون ${PASSWORD_MIN_LENGTH} حروف أو أرقام على الأقل` };
  }
  if (new TextEncoder().encode(password).length > PASSWORD_MAX_BYTES) {
    return { ok: false, message: "كلمة السر طويلة زيادة" };
  }
  if (COMMON_PASSWORDS.has(password.toLowerCase()) || /^(.)\1+$/.test(password)) {
    return { ok: false, message: "كلمة السر دي سهلة التخمين، اختار واحدة تانية" };
  }
  return { ok: true };
}
