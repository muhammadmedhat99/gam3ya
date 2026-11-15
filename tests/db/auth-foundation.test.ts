import bcrypt from "bcryptjs";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createTestDb, type TestDb } from "./harness";

let t: TestDb;

beforeAll(async () => {
  t = await createTestDb();
}, 60_000);

afterAll(async () => {
  await t?.close();
});

const SUPER_PHONE = "+201000000001";

async function insertUser(phone: string, name = "مستخدم تجربة"): Promise<string> {
  const hash = await bcrypt.hash("a-strong-password", 4);
  const res = await t.as("service_role", () =>
    t.db.query<{ id: string }>(
      "insert into public.users (full_name, phone_e164, password_hash) values ($1, $2, $3) returning id",
      [name, phone, hash],
    ),
  );
  return res.rows[0].id;
}

describe("API roles have no access", () => {
  for (const role of ["anon", "authenticated"] as const) {
    it(`${role} cannot read users`, async () => {
      await expect(t.as(role, () => t.db.query("select * from public.users"))).rejects.toThrow(
        /permission denied/,
      );
    });

    it(`${role} cannot read sessions or activity logs`, async () => {
      await expect(
        t.as(role, () => t.db.query("select * from public.user_sessions")),
      ).rejects.toThrow(/permission denied/);
      await expect(
        t.as(role, () => t.db.query("select * from public.activity_logs")),
      ).rejects.toThrow(/permission denied/);
    });

    it(`${role} cannot call admin functions`, async () => {
      await expect(
        t.as(role, () =>
          t.db.query("select public.admin_reset_password($1, null)", [
            "00000000-0000-0000-0000-000000000000",
          ]),
        ),
      ).rejects.toThrow(/permission denied/);
    });
  }
});

describe("users constraints", () => {
  it("rejects non-E.164 phones", async () => {
    await expect(insertUser("01012345678")).rejects.toThrow(/check constraint/);
  });

  it("rejects duplicate phones", async () => {
    await insertUser("+201011111111");
    await expect(insertUser("+201011111111")).rejects.toThrow(/duplicate key/);
  });
});

describe("super admin", () => {
  it("service_role cannot create a super admin directly", async () => {
    await expect(
      t.as("service_role", () =>
        t.db.query(
          "insert into public.users (full_name, phone_e164, password_hash, is_super_admin) values ('x y', '+201022222222', 'h', true)",
        ),
      ),
    ).rejects.toThrow(/database owner/);
  });

  it("service_role cannot call bootstrap_super_admin", async () => {
    await expect(
      t.as("service_role", () =>
        t.db.query("select public.bootstrap_super_admin($1, $2, $3)", [
          SUPER_PHONE,
          "owner@example.com",
          "صاحب التطبيق",
        ]),
      ),
    ).rejects.toThrow(/permission denied/);
  });

  it("bootstrap creates exactly one super admin with a forced temp password", async () => {
    await t.db.query("select public.bootstrap_super_admin($1, $2, $3)", [
      SUPER_PHONE,
      "Owner@Example.com",
      "صاحب التطبيق",
    ]);

    const { rows } = await t.db.query<{
      email: string;
      is_super_admin: boolean;
      must_change_password: boolean;
      password_hash: string;
      expires_in_hours: number;
    }>(
      `select email, is_super_admin, must_change_password, password_hash,
              extract(epoch from (temp_password_expires_at - now())) / 3600 as expires_in_hours
         from public.users where phone_e164 = $1`,
      [SUPER_PHONE],
    );
    const user = rows[0];
    expect(user.is_super_admin).toBe(true);
    expect(user.email).toBe("owner@example.com");
    expect(user.must_change_password).toBe(true);
    expect(Number(user.expires_in_hours)).toBeCloseTo(24, 0);
    expect(await bcrypt.compare("123456789", user.password_hash)).toBe(true);

    await expect(
      t.db.query("select public.bootstrap_super_admin($1, $2, $3)", [
        "+201033333333",
        "",
        "حد تاني",
      ]),
    ).rejects.toThrow(/already exists/);
  }, 30_000);

  it("service_role cannot promote a user to super admin", async () => {
    const id = await insertUser("+201044444444");
    await expect(
      t.as("service_role", () =>
        t.db.query("update public.users set is_super_admin = true where id = $1", [id]),
      ),
    ).rejects.toThrow(/database owner/);
  });
});

describe("admin_reset_password", () => {
  async function superAdminId(): Promise<string> {
    const { rows } = await t.db.query<{ id: string }>(
      "select id from public.users where is_super_admin",
    );
    return rows[0].id;
  }

  it("resets to the temp password, revokes sessions and audits", async () => {
    const target = await insertUser("+201055555555");
    const actor = await superAdminId();
    await t.as("service_role", () =>
      t.db.query(
        "insert into public.user_sessions (user_id, token_hash, expires_at) values ($1, 'h1', now() + interval '1 day'), ($1, 'h2', now() + interval '1 day')",
        [target],
      ),
    );

    await t.as("service_role", () =>
      t.db.query("select public.admin_reset_password($1, $2)", [target, actor]),
    );

    const user = (
      await t.db.query<{ password_hash: string; must_change_password: boolean }>(
        "select password_hash, must_change_password from public.users where id = $1",
        [target],
      )
    ).rows[0];
    expect(user.must_change_password).toBe(true);
    expect(await bcrypt.compare("123456789", user.password_hash)).toBe(true);

    const active = await t.db.query(
      "select 1 from public.user_sessions where user_id = $1 and revoked_at is null",
      [target],
    );
    expect(active.rows).toHaveLength(0);

    const log = await t.db.query<{ metadata: { via: string; as_super_admin: boolean } }>(
      "select metadata from public.activity_logs where entity_id = $1 and action = 'user.password_reset'",
      [target],
    );
    expect(log.rows[0].metadata).toEqual({ via: "panel", as_super_admin: true });
  }, 30_000);

  it("rejects an actor who is not the super admin", async () => {
    const target = await insertUser("+201066666666");
    const notAdmin = await insertUser("+201077777777");
    await expect(
      t.as("service_role", () =>
        t.db.query("select public.admin_reset_password($1, $2)", [target, notAdmin]),
      ),
    ).rejects.toThrow(/not the super admin/);
  });
});

describe("admin_recover_account", () => {
  it("replaces name/email, resets password and logs the previous name", async () => {
    const target = await insertUser("+201088888888", "اللي سجل بالغلط");
    const { rows } = await t.db.query<{ id: string }>(
      "select id from public.users where is_super_admin",
    );
    await t.as("service_role", () =>
      t.db.query("select public.admin_recover_account($1, $2, $3, $4, $5)", [
        target,
        "صاحب الرقم",
        "",
        rows[0].id,
        "اتأكدت بمكالمة على الرقم",
      ]),
    );

    const user = (
      await t.db.query<{ full_name: string; email: string | null; must_change_password: boolean }>(
        "select full_name, email, must_change_password from public.users where id = $1",
        [target],
      )
    ).rows[0];
    expect(user).toEqual({ full_name: "صاحب الرقم", email: null, must_change_password: true });

    const log = await t.db.query<{ metadata: { previous_name: string } }>(
      "select metadata from public.activity_logs where entity_id = $1 and action = 'user.account_recovered'",
      [target],
    );
    expect(log.rows[0].metadata.previous_name).toBe("اللي سجل بالغلط");
  }, 30_000);

  it("requires a note", async () => {
    const target = await insertUser("+201099999999");
    await expect(
      t.as("service_role", () =>
        t.db.query("select public.admin_recover_account($1, 'اسم جديد', '', null, '  ')", [target]),
      ),
    ).rejects.toThrow(/note is required/);
  });
});

describe("activity_logs", () => {
  it("is append-only, even for service_role", async () => {
    await expect(
      t.as("service_role", () => t.db.query("update public.activity_logs set action = 'x'")),
    ).rejects.toThrow();
    await expect(t.db.query("delete from public.activity_logs")).rejects.toThrow(/append-only/);
  });
});
