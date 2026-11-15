import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createTestDb, type TestDb } from "./harness";

let t: TestDb;
let phoneSeq = 30000;

beforeAll(async () => {
  t = await createTestDb();
}, 60_000);

afterAll(async () => {
  await t?.close();
});

const nextPhone = () => `+2010${String(++phoneSeq).padStart(8, "0")}`;
const today = () => new Date().toISOString().slice(0, 10);

async function server<T>(sql: string, params: unknown[] = []): Promise<T[]> {
  return (await t.as("service_role", () => t.db.query<T>(sql, params))).rows;
}

async function user(): Promise<{ id: string; phone: string }> {
  const phone = nextPhone();
  const [r] = await server<{ id: string }>("select public.register_user('مستخدم', $1, 'h') as id", [phone]);
  return { id: r.id, phone };
}

async function group(owner: string, slots = 3, start = "2099-01-01"): Promise<string> {
  const [g] = await server<{ id: string }>(
    "select public.create_group($1, 'جمعية', 1000, $2, 'monthly', $3, 5) as id",
    [owner, slots, start],
  );
  return g.id;
}

const settings = (actor: string, g: string, o: Partial<{ name: string; amount: string; slots: number; frequency: string; start: string; due: number }> = {}) =>
  server("select public.update_group_settings($1, $2, $3, $4, $5, $6, $7, $8)", [
    actor,
    g,
    o.name ?? "جمعية",
    o.amount ?? "1000",
    o.slots ?? 3,
    o.frequency ?? "monthly",
    o.start ?? "2099-01-01",
    o.due ?? 5,
  ]);

async function activeSlots(g: string) {
  return server<{ slot_number: number; payout_order: number }>(
    "select slot_number, payout_order from public.group_slots where group_id = $1 and status <> 'inactive' order by payout_order",
    [g],
  );
}

async function linkedMember(owner: string, g: string): Promise<string> {
  const u = await user();
  await server("select public.add_group_member($1, $2, 'عضو', $3, true)", [owner, g, u.phone]);
  return u.id;
}

describe("API roles have no access", () => {
  for (const role of ["anon", "authenticated"] as const) {
    it(`${role} cannot call the settings functions`, async () => {
      for (const sql of [
        "select public.complete_group(gen_random_uuid(), gen_random_uuid())",
        "select public.set_group_role(gen_random_uuid(), gen_random_uuid(), gen_random_uuid(), 'admin')",
        "select public.remove_group_role(gen_random_uuid(), gen_random_uuid(), gen_random_uuid())",
      ]) {
        await expect(t.as(role, () => t.db.query(sql))).rejects.toThrow(/permission denied/);
      }
    });
  }
});

describe("update_group_settings", () => {
  it("draft: changes amount/schedule and grows the slot list in order", async () => {
    const owner = await user();
    const g = await group(owner.id, 3);
    await settings(owner.id, g, { name: "جمعية جديدة", amount: "2000", slots: 5, frequency: "semi_monthly", due: 0 });
    const [row] = await server<{ name: string; slot_amount: string; target_slot_count: number; frequency: string }>(
      "select name, slot_amount::text, target_slot_count, frequency from public.groups where id = $1",
      [g],
    );
    expect(row).toEqual({ name: "جمعية جديدة", slot_amount: "2000.00", target_slot_count: 5, frequency: "semi_monthly" });
    expect(await activeSlots(g)).toEqual([1, 2, 3, 4, 5].map((n) => ({ slot_number: n, payout_order: n })));
  });

  it("draft: shrinking drops the highest slots, keeps payout order compact, and re-growing reuses them", async () => {
    const owner = await user();
    const g = await group(owner.id, 4);
    const ids = (await server<{ id: string }>("select id from public.group_slots where group_id = $1 order by slot_number", [g])).map((r) => r.id);
    // order: 4, 1, 3, 2
    await server("select public.reorder_payouts($1, $2, $3)", [owner.id, g, [ids[3], ids[0], ids[2], ids[1]]]);

    await settings(owner.id, g, { slots: 2 }); // drops slots 4 and 3
    expect(await activeSlots(g)).toEqual([
      { slot_number: 1, payout_order: 1 },
      { slot_number: 2, payout_order: 2 },
    ]);

    await settings(owner.id, g, { slots: 3 }); // slot 3 comes back at the end
    expect(await activeSlots(g)).toEqual([
      { slot_number: 1, payout_order: 1 },
      { slot_number: 2, payout_order: 2 },
      { slot_number: 3, payout_order: 3 },
    ]);
  });

  it("draft: refuses to drop a slot that still has shares", async () => {
    const owner = await user();
    const g = await group(owner.id, 3);
    const m = await server<{ id: string }>("select public.add_group_member($1, $2, 'عضو', $3, false) as id", [owner.id, g, nextPhone()]);
    const [slot3] = await server<{ id: string }>("select id from public.group_slots where group_id = $1 and slot_number = 3", [g]);
    await server("select public.set_slot_allocations($1, $2, $3::jsonb)", [
      owner.id,
      slot3.id,
      JSON.stringify([{ member_id: m[0].id, amount: "1000" }]),
    ]);
    await expect(settings(owner.id, g, { slots: 2 })).rejects.toThrow(/still have shares/);
  });

  it("after the start only the name changes; non-managers are refused", async () => {
    const owner = await user();
    const g = await group(owner.id, 2);
    const m = await server<{ id: string }>("select public.add_group_member($1, $2, 'عضو', $3, false) as id", [owner.id, g, nextPhone()]);
    for (const s of await server<{ id: string }>("select id from public.group_slots where group_id = $1", [g])) {
      await server("select public.set_slot_allocations($1, $2, $3::jsonb)", [owner.id, s.id, JSON.stringify([{ member_id: m[0].id, amount: "1000" }])]);
    }
    await server("select public.activate_group($1, $2)", [owner.id, g]);

    await settings(owner.id, g, { name: "اسم بعد البدء", slots: 2 });
    await expect(settings(owner.id, g, { slots: 2, amount: "500" })).rejects.toThrow(/locked/);

    const stranger = await user();
    await expect(settings(stranger.id, g, { slots: 2 })).rejects.toThrow(/not allowed/);
  });
});

describe("roles", () => {
  const set = (actor: string, g: string, target: string, role: string) =>
    server("select public.set_group_role($1, $2, $3, $4)", [actor, g, target, role]);
  const remove = (actor: string, g: string, target: string) =>
    server("select public.remove_group_role($1, $2, $3)", [actor, g, target]);

  it("owner manages admins; admins manage collectors only", async () => {
    const owner = await user();
    const g = await group(owner.id);
    const admin = await linkedMember(owner.id, g);
    const helper = await linkedMember(owner.id, g);
    const other = await linkedMember(owner.id, g);

    await set(owner.id, g, admin, "admin");
    await expect(set(admin, g, other, "admin")).rejects.toThrow(/only the owner/);
    await set(admin, g, helper, "collector");
    await remove(admin, g, helper);
    await expect(remove(admin, g, admin)).rejects.toThrow(/only the owner/);
    await remove(owner.id, g, admin);

    const roles = await server<{ role: string }>("select role from public.group_roles where group_id = $1", [g]);
    expect(roles).toEqual([{ role: "owner" }]);
  });

  it("only linked members get roles; the owner can't be changed or removed", async () => {
    const owner = await user();
    const g = await group(owner.id);
    const outsider = await user();
    await expect(set(owner.id, g, outsider.id, "collector")).rejects.toThrow(/linked account/);
    await expect(set(owner.id, g, owner.id, "collector")).rejects.toThrow(/owner role/);
    await expect(remove(owner.id, g, owner.id)).rejects.toThrow(/owner role/);
    await expect(set(owner.id, g, outsider.id, "owner")).rejects.toThrow(/admin or collector/);
  });
});

describe("completion", () => {
  /** 2 slots × 1000, one member owning both, started long ago. */
  async function started(start = "2020-01-01") {
    const owner = await user();
    const g = await group(owner.id, 2, start);
    const [m] = await server<{ id: string }>("select public.add_group_member($1, $2, 'عضو', $3, false) as id", [owner.id, g, nextPhone()]);
    for (const s of await server<{ id: string }>("select id from public.group_slots where group_id = $1", [g])) {
      await server("select public.set_slot_allocations($1, $2, $3::jsonb)", [owner.id, s.id, JSON.stringify([{ member_id: m.id, amount: "1000" }])]);
    }
    await server("select public.activate_group($1, $2)", [owner.id, g]);
    const cycles = (await server<{ id: string }>("select id from public.group_cycles where group_id = $1 order by cycle_number", [g])).map((r) => r.id);
    return { owner: owner.id, g, cycles };
  }
  const status = async (g: string) =>
    (await server<{ status: string }>("select status from public.groups where id = $1", [g]))[0].status;

  it("manual: refused before the last cycle starts, allowed after", async () => {
    const future = await started("2099-01-01");
    await expect(server("select public.complete_group($1, $2)", [future.owner, future.g])).rejects.toThrow(/not started/);

    const past = await started();
    await server("select public.complete_group($1, $2)", [past.owner, past.g]);
    expect(await status(past.g)).toBe("completed");
  });

  it("automatic: paying out the whole last cycle completes the group (an earlier cycle doesn't)", async () => {
    const { owner, g, cycles } = await started();
    const payAll = async (cycle: string) => {
      const [p] = await server<{ id: string }>("select public.ensure_payout($1, $2) as id", [owner, cycle]);
      const [a] = await server<{ id: string; expected_amount: string }>(
        "select id, expected_amount::text from public.payout_allocations where payout_id = $1",
        [p.id],
      );
      await server("select public.record_payout_disbursement($1, $2, $3, $4, 'cash')", [owner, a.id, a.expected_amount, today()]);
    };

    await payAll(cycles[0]);
    expect(await status(g)).toBe("active");
    await payAll(cycles[1]);
    expect(await status(g)).toBe("completed");

    const log = await server<{ metadata: { auto: boolean } }>(
      "select metadata from public.activity_logs where group_id = $1 and action = 'group.completed'",
      [g],
    );
    expect(log).toEqual([{ metadata: { auto: true } }]);
  });
});
