import "server-only";
import { cookies } from "next/headers";
import { SESSION_COOKIE, SESSION_MAX_AGE_SECONDS } from "@/lib/auth/cookie";
import { generateSessionToken, hashSessionToken } from "@/lib/auth/tokens";
import { db } from "@/lib/supabase/admin";

/** Creates a DB session and sets the cookie. Call only from Server Actions / Route Handlers. */
export async function createSession(userId: string): Promise<void> {
  const token = generateSessionToken();
  const expiresAt = new Date(Date.now() + SESSION_MAX_AGE_SECONDS * 1000);

  const { error } = await db().from("user_sessions").insert({
    user_id: userId,
    token_hash: hashSessionToken(token),
    expires_at: expiresAt.toISOString(),
    last_seen_at: new Date().toISOString(),
  });
  if (error) throw new Error(`createSession failed: ${error.message}`);

  (await cookies()).set(SESSION_COOKIE, token, {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax",
    path: "/",
    expires: expiresAt,
  });
}

/** Hash of the token in the incoming cookie, or null. */
export async function currentTokenHash(): Promise<string | null> {
  const token = (await cookies()).get(SESSION_COOKIE)?.value;
  return token ? hashSessionToken(token) : null;
}

/** Revokes the current session (if any) and clears the cookie. */
export async function destroyCurrentSession(): Promise<void> {
  const tokenHash = await currentTokenHash();
  if (tokenHash) {
    await db()
      .from("user_sessions")
      .update({ revoked_at: new Date().toISOString() })
      .eq("token_hash", tokenHash)
      .is("revoked_at", null);
  }
  (await cookies()).delete(SESSION_COOKIE);
}

/** Revokes every active session of the user except the current one. */
export async function revokeOtherSessions(userId: string, keepSessionId: string): Promise<void> {
  const { error } = await db()
    .from("user_sessions")
    .update({ revoked_at: new Date().toISOString() })
    .eq("user_id", userId)
    .neq("id", keepSessionId)
    .is("revoked_at", null);
  if (error) throw new Error(`revokeOtherSessions failed: ${error.message}`);
}
