import "server-only";
import { headers } from "next/headers";
import { serverEnv } from "@/lib/env";
import { hashIp } from "@/lib/auth/tokens";
import { db } from "@/lib/supabase/admin";

const WINDOW_MS = 15 * 60 * 1000;
export const MAX_FAILED_LOGINS_PER_PHONE = 5;
const MAX_FAILED_LOGINS_PER_IP = 20;
const MAX_REGISTRATIONS_PER_IP = 10;

type AttemptKind = "login" | "register";

/** Keyed hash of the caller's IP (Vercel sets x-forwarded-for), or null if unknown. */
export async function clientIpHash(): Promise<string | null> {
  const h = await headers();
  const ip = h.get("x-forwarded-for")?.split(",")[0]?.trim() || h.get("x-real-ip");
  return ip ? hashIp(ip, serverEnv().SUPABASE_SECRET_KEY) : null;
}

function windowStart(): string {
  return new Date(Date.now() - WINDOW_MS).toISOString();
}

export async function recordAttempt(
  phone: string,
  ipHash: string | null,
  kind: AttemptKind,
  succeeded: boolean,
): Promise<void> {
  const { error } = await db()
    .from("login_attempts")
    .insert({ phone_e164: phone, ip_hash: ipHash, kind, succeeded });
  if (error) throw new Error(`recordAttempt failed: ${error.message}`);
}

export interface PhoneLoginState {
  /** Failed logins in the window since the last successful one. */
  failures: number;
  attemptsLeft: number;
  /** When the phone may try again, if it's locked now. */
  lockedUntil: Date | null;
}

/**
 * Per-phone lock: 5 failures within 15 minutes (after the last success) locks the
 * phone until the oldest of those failures leaves the window. Works for phones
 * with no account too, so the response doesn't reveal which phones are registered.
 */
export async function phoneLoginState(phone: string): Promise<PhoneLoginState> {
  const { data: lastSuccess, error: successError } = await db()
    .from("login_attempts")
    .select("created_at")
    .eq("phone_e164", phone)
    .eq("kind", "login")
    .eq("succeeded", true)
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle<{ created_at: string }>();
  if (successError) throw new Error(`phoneLoginState failed: ${successError.message}`);

  const since =
    lastSuccess && lastSuccess.created_at > windowStart() ? lastSuccess.created_at : windowStart();

  const { data, error } = await db()
    .from("login_attempts")
    .select("created_at")
    .eq("phone_e164", phone)
    .eq("kind", "login")
    .eq("succeeded", false)
    .gt("created_at", since)
    .order("created_at", { ascending: false })
    .limit(MAX_FAILED_LOGINS_PER_PHONE)
    .returns<{ created_at: string }[]>();
  if (error) throw new Error(`phoneLoginState failed: ${error.message}`);

  const failures = data.length;
  const lockedUntil =
    failures >= MAX_FAILED_LOGINS_PER_PHONE
      ? new Date(new Date(data[failures - 1].created_at).getTime() + WINDOW_MS)
      : null;

  return {
    failures,
    attemptsLeft: Math.max(0, MAX_FAILED_LOGINS_PER_PHONE - failures),
    lockedUntil: lockedUntil && lockedUntil > new Date() ? lockedUntil : null,
  };
}

async function countByIp(ipHash: string, kind: AttemptKind, onlyFailures: boolean): Promise<number> {
  let query = db()
    .from("login_attempts")
    .select("id", { count: "exact", head: true })
    .eq("ip_hash", ipHash)
    .eq("kind", kind)
    .gte("created_at", windowStart());
  if (onlyFailures) query = query.eq("succeeded", false);
  const { count, error } = await query;
  if (error) throw new Error(`countByIp failed: ${error.message}`);
  return count ?? 0;
}

/** Many phones tried from one device: slows down guessing across accounts. */
export async function isIpLoginLimited(ipHash: string | null): Promise<boolean> {
  return ipHash !== null && (await countByIp(ipHash, "login", true)) >= MAX_FAILED_LOGINS_PER_IP;
}

export async function isRegisterRateLimited(ipHash: string | null): Promise<boolean> {
  return ipHash !== null && (await countByIp(ipHash, "register", false)) >= MAX_REGISTRATIONS_PER_IP;
}

/** Mirror the lock on the user row, so the super admin can see it. */
export async function syncUserLock(userId: string, state: PhoneLoginState): Promise<void> {
  await db()
    .from("users")
    .update({
      failed_login_count: state.failures,
      locked_until: state.lockedUntil?.toISOString() ?? null,
    })
    .eq("id", userId);
}
