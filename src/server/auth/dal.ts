import "server-only";
import { notFound, redirect } from "next/navigation";
import { after } from "next/server";
import { cache } from "react";
import { db } from "@/lib/supabase/admin";
import { currentTokenHash } from "./session";

/** What the rest of the app may know about the signed-in user. Never includes secrets. */
export interface CurrentUser {
  id: string;
  sessionId: string;
  fullName: string;
  phone: string;
  email: string | null;
  isSuperAdmin: boolean;
  mustChangePassword: boolean;
}

interface SessionRow {
  id: string;
  expires_at: string;
  revoked_at: string | null;
  last_seen_at: string | null;
  users: {
    id: string;
    full_name: string;
    phone_e164: string;
    email: string | null;
    is_super_admin: boolean;
    must_change_password: boolean;
    status: "active" | "blocked";
  };
}

const LAST_SEEN_THROTTLE_MS = 5 * 60 * 1000;

/**
 * Verifies the session cookie against the database on every request
 * (memoized per render pass). Returns null when not signed in.
 */
export const getCurrentUser = cache(async (): Promise<CurrentUser | null> => {
  const tokenHash = await currentTokenHash();
  if (!tokenHash) return null;

  const { data, error } = await db()
    .from("user_sessions")
    .select(
      "id, expires_at, revoked_at, last_seen_at, users!inner(id, full_name, phone_e164, email, is_super_admin, must_change_password, status)",
    )
    .eq("token_hash", tokenHash)
    .maybeSingle<SessionRow>();

  if (error) throw new Error(`getCurrentUser failed: ${error.message}`);
  if (!data || data.revoked_at || new Date(data.expires_at) <= new Date()) return null;
  if (data.users.status !== "active") return null;

  const lastSeen = data.last_seen_at ? new Date(data.last_seen_at).getTime() : 0;
  if (Date.now() - lastSeen > LAST_SEEN_THROTTLE_MS) {
    // Bookkeeping only: run it after the response so it never slows a page down.
    after(async () => {
      await db().from("user_sessions").update({ last_seen_at: new Date().toISOString() }).eq("id", data.id);
    });
  }

  return {
    id: data.users.id,
    sessionId: data.id,
    fullName: data.users.full_name,
    phone: data.users.phone_e164,
    email: data.users.email,
    isSuperAdmin: data.users.is_super_admin,
    mustChangePassword: data.users.must_change_password,
  };
});

/**
 * Use at the top of every protected page, layout and Server Action.
 * While a reset password is pending, only the change-password flow is allowed.
 */
export async function requireUser(
  options: { allowPendingPasswordChange?: boolean } = {},
): Promise<CurrentUser> {
  const user = await getCurrentUser();
  if (!user) redirect("/login");
  if (user.mustChangePassword && !options.allowPendingPasswordChange) {
    redirect("/change-password");
  }
  return user;
}

/** Super-admin-only areas. Hidden (404) for everyone else. */
export async function requireSuperAdmin(): Promise<CurrentUser> {
  const user = await requireUser();
  if (!user.isSuperAdmin) notFound();
  return user;
}
