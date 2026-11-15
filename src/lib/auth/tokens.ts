import "server-only";
import { createHash, createHmac, randomBytes } from "node:crypto";

/** 256-bit random session token, sent only in the HttpOnly cookie. */
export function generateSessionToken(): string {
  return randomBytes(32).toString("base64url");
}

/** What we store in user_sessions.token_hash. */
export function hashSessionToken(token: string): string {
  return createHash("sha256").update(token).digest("hex");
}

/**
 * Keyed hash of a client IP for rate limiting. Keyed so stored values can't be
 * reversed by hashing every IPv4 address.
 */
export function hashIp(ip: string, key: string): string {
  return createHmac("sha256", key).update(ip).digest("hex");
}
