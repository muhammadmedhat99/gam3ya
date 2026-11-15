/**
 * Checks the hosted Supabase project after migrations are pasted in the SQL Editor.
 * Run: node --env-file=.env.local scripts/check-db.mts
 *
 * - the secret key (server) can read the auth tables
 * - the publishable key (browser/anon) is denied on every private table and function
 * - exactly one super admin exists
 */
import { createClient } from "@supabase/supabase-js";

const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
const secretKey = process.env.SUPABASE_SECRET_KEY;
const publishableKey = process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY;

if (!url || !secretKey || !publishableKey) {
  console.error(
    "Missing NEXT_PUBLIC_SUPABASE_URL, SUPABASE_SECRET_KEY or NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY in .env.local",
  );
  process.exit(1);
}

const options = { auth: { persistSession: false, autoRefreshToken: false } };
const server = createClient(url, secretKey, options);
const browser = createClient(url, publishableKey, options);

const PRIVATE_TABLES = [
  "users",
  "login_attempts",
  "user_sessions",
  "activity_logs",
  "groups",
  "group_members",
  "group_roles",
  "member_link_requests",
  "group_slots",
  "slot_allocations",
  "group_cycles",
  "member_obligations",
  "payment_records",
  "payout_records",
  "payout_allocations",
  "payout_disbursements",
  "notifications",
];

// Views have no "id" column; checked separately below.
const PRIVATE_VIEWS = ["obligation_balances", "payout_allocation_balances"];
let failures = 0;

function report(ok: boolean, label: string, detail = "") {
  if (!ok) failures++;
  console.log(`${ok ? "✓" : "✗"} ${label}${detail ? ` — ${detail}` : ""}`);
}

for (const table of PRIVATE_TABLES) {
  const { error } = await server.from(table).select("id", { head: true, count: "exact" });
  report(!error, `server can read ${table}`, error?.message);
}

for (const table of PRIVATE_TABLES) {
  const { data, error } = await browser.from(table).select("id").limit(1);
  report(Boolean(error) && !data, `publishable key is denied on ${table}`, error ? error.code : "NOT DENIED");
}

for (const view of PRIVATE_VIEWS) {
  const ok = await server.from(view).select("*", { head: true, count: "exact" });
  report(!ok.error, `server can read ${view}`, ok.error?.message);
  const { data, error } = await browser.from(view).select("*").limit(1);
  report(Boolean(error) && !data, `publishable key is denied on ${view}`, error ? error.code : "NOT DENIED");
}

{
  const { error } = await browser.rpc("record_payment", {
    p_actor_user_id: "00000000-0000-0000-0000-000000000000",
    p_obligation_id: "00000000-0000-0000-0000-000000000000",
    p_amount: 1,
    p_paid_on: "2027-01-01",
    p_method: "cash",
  });
  report(Boolean(error), "publishable key cannot call record_payment", error?.code ?? "NOT DENIED");
}

{
  const { error } = await browser.rpc("admin_reset_password", {
    p_target_user_id: "00000000-0000-0000-0000-000000000000",
    p_actor_user_id: null,
  });
  report(Boolean(error), "publishable key cannot call admin_reset_password", error?.code ?? "NOT DENIED");
}

{
  const { error } = await browser.rpc("register_user", {
    p_full_name: "x",
    p_phone_e164: "+201000000000",
    p_password_hash: "x",
  });
  report(Boolean(error), "publishable key cannot call register_user", error?.code ?? "NOT DENIED");
}

{
  const { count, error } = await server
    .from("users")
    .select("id", { head: true, count: "exact" })
    .eq("is_super_admin", true);
  report(!error && count === 1, "exactly one super admin", error?.message ?? `found ${count}`);
}

console.log(failures ? `\n${failures} check(s) failed` : "\nAll checks passed");
process.exit(failures ? 1 : 0);
