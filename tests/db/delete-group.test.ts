import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createTestDb, type TestDb } from "./harness";

let t: TestDb;
let phoneSeq = 60000;

beforeAll(async () => {
  t = await createTestDb();
}, 60_000);

afterAll(async () => {
  await t?.close();
});

const nextPhone = () => `+2010${String(++phoneSeq).padStart(8, "0")}`;

async function server<T>(sql: string, params: unknown[] = []): Promise<T[]> {
  return (await t.as("service_role", () => t.db.query<T>(sql, params))).rows;
}

async function user(phone = nextPhone()): Promise<{ id: string; phone: string }> {
  const [r] = await server<{ id: string }>("select public.register_user('مستخدم', $1, 'h') as id", [phone]);
  return { id: r.id, phone };
}

/** 2 slots × 1000 owned by one linked member; optionally started long ago and completed. */
async function setup(opts: { start?: string; activate?: boolean; complete?: boolean } = {}) {
  const owner = await user();
  const [g] = await server<{ id: string }>(
    "select public.create_group($1, 'جمعية للمسح', 1000, 2, 'monthly', $2, 5) as id",
    [owner.id, opts.start ?? "2020-01-01"],
  );
  const member = await user();
  const [m] = await server<{ id: string }>("select public.add_group_member($1, $2, 'عضو', $3, true) as id", [
    owner.id,
    g.id,
    member.phone,
  ]);
  for (const s of await server<{ id: string }>("select id from public.group_slots where group_id = $1", [g.id])) {
    await server("select public.set_slot_allocations($1, $2, $3::jsonb)", [
      owner.id,
      s.id,
      JSON.stringify([{ member_id: m.id, amount: "1000" }]),
    ]);
  }
  if (opts.activate || opts.complete) await server("select public.activate_group($1, $2)", [owner.id, g.id]);
  if (opts.complete) await server("select public.complete_group($1, $2)", [owner.id, g.id]);
  return { owner: owner.id, member: member.id, memberRow: m.id, groupId: g.id };
}

const del = (actor: string, g: string) => server("select public.delete_group($1, $2)", [actor, g]);

describe("delete_group", () => {
  it("anon/authenticated can't call it", async () => {
    for (const role of ["anon", "authenticated"] as const) {
      await expect(
        t.as(role, () => t.db.query("select public.delete_group(gen_random_uuid(), gen_random_uuid())")),
      ).rejects.toThrow(/permission denied/);
    }
  });

  it("only the owner may delete; admins can't", async () => {
    const g = await setup();
    await server("select public.set_group_role($1, $2, $3, 'admin')", [g.owner, g.groupId, g.member]);
    await expect(del(g.member, g.groupId)).rejects.toThrow(/only the owner/);
  });

  it("refuses an active group", async () => {
    const g = await setup({ activate: true });
    await expect(del(g.owner, g.groupId)).rejects.toThrow(/draft or completed/);
  });

  it("deletes a draft: hidden, frozen, link requests cancelled, members notified", async () => {
    const g = await setup();
    const phone = nextPhone();
    await server("select public.add_group_member($1, $2, 'جديد', $3, false)", [g.owner, g.groupId, phone]);
    const newcomer = await user(phone); // creates a pending link request

    await del(g.owner, g.groupId);

    const [row] = await server<{ deleted_at: string | null }>("select deleted_at from public.groups where id = $1", [g.groupId]);
    expect(row.deleted_at).not.toBeNull();

    // Frozen through the shared helpers.
    const [mgr] = await server<{ ok: boolean }>("select public.is_group_manager($1, $2) as ok", [g.groupId, g.owner]);
    expect(mgr.ok).toBe(false);
    await expect(
      server("select public.add_group_member($1, $2, 'تاني', $3, false)", [g.owner, g.groupId, nextPhone()]),
    ).rejects.toThrow(/not allowed/);

    const reqs = await server<{ status: string }>("select status from public.member_link_requests where user_id = $1", [newcomer.id]);
    expect(reqs.map((r) => r.status)).toEqual(["cancelled"]);

    const notes = await server<{ type: string; group_id: string | null }>(
      "select type, group_id from public.notifications where user_id = $1 and type = 'group_deleted'",
      [g.member],
    );
    expect(notes).toEqual([{ type: "group_deleted", group_id: null }]);

    await expect(del(g.owner, g.groupId)).rejects.toThrow(/not found/);
  });

  it("deletes a completed group but keeps its financial records and blocks new ones", async () => {
    const g = await setup({ complete: true });
    const [ob] = await server<{ id: string }>(
      `select o.id from public.member_obligations o join public.group_cycles c on c.id = o.cycle_id
        where c.group_id = $1 and c.cycle_number = 1`,
      [g.groupId],
    );
    await server("select public.record_payment($1, $2, 500, '2020-01-02', 'cash')", [g.owner, ob.id]);

    await del(g.owner, g.groupId);

    const kept = await server("select 1 from public.payment_records where obligation_id = $1", [ob.id]);
    expect(kept).toHaveLength(1);
    await expect(
      server("select public.record_payment($1, $2, 100, '2020-01-03', 'cash')", [g.owner, ob.id]),
    ).rejects.toThrow(/not allowed/);
  });
});
