import "server-only";
import bcrypt from "bcryptjs";

/** Same algorithm/cost as the database's temp_password_hash() (pgcrypto bf, 12). */
const BCRYPT_COST = 12;

export function hashPassword(password: string): Promise<string> {
  return bcrypt.hash(password, BCRYPT_COST);
}

export function verifyPassword(password: string, hash: string): Promise<boolean> {
  return bcrypt.compare(password, hash);
}

let dummyHash: Promise<string> | undefined;

/**
 * Burn the same time as a real check when the phone has no account, so
 * response timing doesn't reveal which phones are registered.
 */
export async function verifyAgainstDummy(password: string): Promise<false> {
  dummyHash ??= bcrypt.hash("dummy-password-for-timing", BCRYPT_COST);
  await bcrypt.compare(password, await dummyHash);
  return false;
}
