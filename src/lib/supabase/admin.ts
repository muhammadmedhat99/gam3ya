import "server-only";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { serverEnv } from "@/lib/env";

let client: SupabaseClient | undefined;

/**
 * Server-only Supabase client using the secret key (service_role).
 * It bypasses RLS, so every caller must enforce authorization itself
 * (see src/server/auth/dal.ts). Never import this from client components.
 */
export function db(): SupabaseClient {
  if (!client) {
    const env = serverEnv();
    client = createClient(env.NEXT_PUBLIC_SUPABASE_URL, env.SUPABASE_SECRET_KEY, {
      auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
    });
  }
  return client;
}
