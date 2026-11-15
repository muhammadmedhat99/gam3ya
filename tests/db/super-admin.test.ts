import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createTestDb, type TestDb } from "./harness";

let t: TestDb;
let phoneSeq = 50000;
let admin: string;

beforeAll(async () => {
  t = await createTestDb();
  const res = await t.db.query<{ id: string }>(
    "select public.bootstrap_super_admin('+201099999999', '', 'صاحب التطبيق') as id",
  );
  admin = res.rows[0].id;
}, 60_000);

afterAll(async () => {
  await t?.close();
});

const nextPhone = () => `+2012${String(++phoneSeq).padStart(8, "0")}`;

async function server<T>(sql: string, params: unknown[] = []): Promise<T[]> {
  return (await t.as("service_role", () => t.db.query<T>(sql, params))).rows;
}

async function user(): Promise<string> {
  const [r] = await server<{ id: string }>("select public.register_user('مستخدم', $1, 'h') as id", [nextPhone()]);
  return r.id;
}

const setStatus = (actor: string, target: string, status: string) =>
  server("select public.admin_set_user_status($1, $2, $3, 'سبب')", [actor, target, status]);

describe("admin_set_user_status", () => {
  it("anon/authenticated can't call it", async () => {
    for (const role of ["anon", "authenticated"] as const) {
      await expect(
        t.as(role, () => t.db.query("select public.admin_set_user_status(gen_random_uuid(), gen_random_uuid(), 'blocked')")),
      ).rejects.toThrow(/permission denied/);
    }
  });

  it("only the super admin may block; blocking revokes sessions and is audited", async () => {
    const target = await user();
    const someone = await user();
    await server(
      "insert into public.user_sessions (user_id, token_hash, expires_at) values ($1, $2, now() + interval '1 day')",
      [target, `tok-${target}`],
    );

    await expect(setStatus(someone, target, "blocked")).rejects.toThrow(/not the super admin/);
    await setStatus(admin, target, "blocked");

    const [u] = await server<{ status: string }>("select status from public.users where id = $1", [target]);
    expect(u.status).toBe("blocked");
    const active = await server("select 1 from public.user_sessions where user_id = $1 and revoked_at is null", [target]);
    expect(active).toHaveLength(0);
    const log = await server("select 1 from public.activity_logs where entity_id = $1 and action = 'user.blocked'", [target]);
    expect(log).toHaveLength(1);

    await setStatus(admin, target, "active");
    const [back] = await server<{ status: string }>("select status from public.users where id = $1", [target]);
    expect(back.status).toBe("active");
  });

  it("the super admin can't be blocked", async () => {
    await expect(setStatus(admin, admin, "blocked")).rejects.toThrow(/cannot be blocked/);
  });
});
