import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { buildSchedule, type Frequency } from "@/lib/schedule";
import { createTestDb, type TestDb } from "./harness";

let t: TestDb;
let phoneSeq = 5000;

beforeAll(async () => {
  t = await createTestDb();
}, 60_000);

afterAll(async () => {
  await t?.close();
});

const nextPhone = () => `+2011${String(++phoneSeq).padStart(8, "0")}`;

async function server<T>(sql: string, params: unknown[] = []): Promise<T[]> {
  return (await t.as("service_role", () => t.db.query<T>(sql, params))).rows;
}

async function user(name = "مستخدم"): Promise<string> {
  const [r] = await server<{ id: string }>("select public.register_user($1, $2, 'h') as id", [name, nextPhone()]);
  return r.id;
}

interface Setup {
  owner: string;
  groupId: string;
  slots: string[];
  members: Record<string, string>;
}

/**
 * Design example: 3 slots × 1000.
 *  slot 1: محمد 1000 · slot 2: إبراهيم 750 + أسامة 250 · slot 3: محمد 1000
 */
async function setup(opts: { start?: string; frequency?: Frequency; dueDay?: number; complete?: boolean } = {}): Promise<Setup> {
  const owner = await user("صاحب");
  const [g] = await server<{ id: string }>(
    "select public.create_group($1, 'جمعية', 1000, 3, $2, $3, $4) as id",
    [owner, opts.frequency ?? "monthly", opts.start ?? "2099-01-01", opts.dueDay ?? 5],
  );
  const members: Record<string, string> = {};
  for (const name of ["محمد", "إبراهيم", "أسامة"]) {
    const [m] = await server<{ id: string }>(
      "select public.add_group_member($1, $2, $3, $4, false) as id",
      [owner, g.id, name, nextPhone()],
    );
    members[name] = m.id;
  }
  const slots = (
    await server<{ id: string }>("select id from public.group_slots where group_id = $1 order by slot_number", [g.id])
  ).map((r) => r.id);

  const set = (slot: string, list: [string, string][]) =>
    server("select public.set_slot_allocations($1, $2, $3::jsonb)", [
      owner,
      slot,
      JSON.stringify(list.map(([m, amount]) => ({ member_id: members[m], amount }))),
    ]);
  await set(slots[0], [["محمد", "1000"]]);
  await set(slots[1], [["إبراهيم", "750"], ["أسامة", "250"]]);
  if (opts.complete !== false) await set(slots[2], [["محمد", "1000"]]);

  return { owner, groupId: g.id, slots, members };
}

const activate = (actor: string, groupId: string) =>
  server("select public.activate_group($1, $2)", [actor, groupId]);

describe("API roles have no access", () => {
  for (const role of ["anon", "authenticated"] as const) {
    for (const table of ["group_cycles", "member_obligations"]) {
      it(`${role} cannot read ${table}`, async () => {
        await expect(t.as(role, () => t.db.query(`select * from public.${table}`))).rejects.toThrow(
          /permission denied/,
        );
      });
    }
    it(`${role} cannot call activate_group`, async () => {
      await expect(
        t.as(role, () => t.db.query("select public.activate_group(gen_random_uuid(), gen_random_uuid())")),
      ).rejects.toThrow(/permission denied/);
    });
  }
});

describe("group_schedule matches the app's buildSchedule", () => {
  const cases: { start: string; frequency: Frequency; dueDay: number }[] = [
    { start: "2027-01-01", frequency: "monthly", dueDay: 5 },
    { start: "2027-01-20", frequency: "monthly", dueDay: 5 },
    { start: "2027-01-31", frequency: "monthly", dueDay: 28 },
    { start: "2027-01-01", frequency: "semi_monthly", dueDay: 0 },
    { start: "2027-02-10", frequency: "semi_monthly", dueDay: 3 },
  ];
  for (const c of cases) {
    it(`${c.frequency} from ${c.start}, due ${c.dueDay}`, async () => {
      const rows = await server<{ cycle_number: number; starts_on: string; due_on: string }>(
        "select cycle_number, starts_on::text, due_on::text from public.group_schedule($1, $2, $3, 12)",
        [c.start, c.frequency, c.dueDay],
      );
      const expected = buildSchedule({ startDate: c.start, frequency: c.frequency, dueDay: c.dueDay, cycles: 12 });
      expect(rows.map((r) => ({ number: r.cycle_number, startsOn: r.starts_on, dueOn: r.due_on }))).toEqual(expected);
    });
  }
});

describe("activate_group", () => {
  it("is for owners/admins only", async () => {
    const { groupId } = await setup();
    const stranger = await user();
    await expect(activate(stranger, groupId)).rejects.toThrow(/not allowed/);
  });

  it("refuses until every slot is fully allocated", async () => {
    const { owner, groupId } = await setup({ complete: false });
    await expect(activate(owner, groupId)).rejects.toThrow(/fully allocated/);
    const [g] = await server<{ status: string }>("select status from public.groups where id = $1", [groupId]);
    expect(g.status).toBe("draft");
  });

  it("creates N cycles with the right dates and snapshots each member's dues", async () => {
    const { owner, groupId, members } = await setup({ start: "2027-01-01", dueDay: 5 });
    await activate(owner, groupId);

    const [g] = await server<{ status: string }>("select status from public.groups where id = $1", [groupId]);
    expect(g.status).toBe("active");

    const cycles = await server<{ cycle_number: number; starts_on: string; due_on: string; ends_on: string }>(
      "select cycle_number, starts_on::text, due_on::text, ends_on::text from public.group_cycles where group_id = $1 order by cycle_number",
      [groupId],
    );
    expect(cycles).toEqual([
      { cycle_number: 1, starts_on: "2027-01-01", due_on: "2027-01-05", ends_on: "2027-01-31" },
      { cycle_number: 2, starts_on: "2027-02-01", due_on: "2027-02-05", ends_on: "2027-02-28" },
      { cycle_number: 3, starts_on: "2027-03-01", due_on: "2027-03-05", ends_on: "2027-03-31" },
    ]);

    const dues = await server<{ member_id: string; amount_due: string; n: string }>(
      `select o.member_id, o.amount_due::text, count(*)::text as n
         from public.member_obligations o join public.group_cycles c on c.id = o.cycle_id
        where c.group_id = $1 group by o.member_id, o.amount_due order by o.amount_due desc`,
      [groupId],
    );
    // محمد owns 2 slots → 2000 every cycle; إبراهيم 750; أسامة 250. One row per cycle each.
    expect(dues).toEqual([
      { member_id: members["محمد"], amount_due: "2000.00", n: "3" },
      { member_id: members["إبراهيم"], amount_due: "750.00", n: "3" },
      { member_id: members["أسامة"], amount_due: "250.00", n: "3" },
    ]);

    // Every cycle's dues add up to the pot (slot amount × slots).
    const pots = await server<{ total: string }>(
      `select sum(o.amount_due)::text as total from public.member_obligations o
         join public.group_cycles c on c.id = o.cycle_id where c.group_id = $1 group by c.id`,
      [groupId],
    );
    expect(pots.every((p) => p.total === "3000.00")).toBe(true);

    const log = await server("select 1 from public.activity_logs where group_id = $1 and action = 'group.activated'", [
      groupId,
    ]);
    expect(log).toHaveLength(1);
  });

  it("can't run twice, and locks settings and allocations afterwards", async () => {
    const { owner, groupId, slots, members } = await setup();
    await activate(owner, groupId);
    await expect(activate(owner, groupId)).rejects.toThrow(/already started/);
    await expect(
      server("select public.set_slot_allocations($1, $2, $3::jsonb)", [
        owner,
        slots[0],
        JSON.stringify([{ member_id: members["أسامة"], amount: "1000" }]),
      ]),
    ).rejects.toThrow(/locked/);
    await expect(server("update public.groups set slot_amount = 5 where id = $1", [groupId])).rejects.toThrow(/locked/);
  });

  it("obligations are immutable", async () => {
    const { owner, groupId } = await setup();
    await activate(owner, groupId);
    await expect(
      server(
        `update public.member_obligations set amount_due = 1 where cycle_id in
           (select id from public.group_cycles where group_id = $1)`,
        [groupId],
      ),
    ).rejects.toThrow(/permission denied|immutable/);
    await expect(
      t.db.query(
        `delete from public.member_obligations where cycle_id in
           (select id from public.group_cycles where group_id = $1)`,
        [groupId],
      ),
    ).rejects.toThrow(/immutable/);
  });
});

describe("reorder_payouts after start", () => {
  it("turns whose cycle has started are locked; future ones can move", async () => {
    // Started long ago: cycle 1 started, 2 and 3 in the future? Use a start 1 month ago.
    const today = new Date();
    const start = new Date(Date.UTC(today.getUTCFullYear(), today.getUTCMonth() - 1, 1)).toISOString().slice(0, 10);
    // 3 monthly cycles: started last month and this month → 2 locked, 1 free. Make 4 slots for room.
    const owner = await user();
    const [g] = await server<{ id: string }>(
      "select public.create_group($1, 'جمعية', 100, 4, 'monthly', $2, 1) as id",
      [owner, start],
    );
    const [m] = await server<{ id: string }>("select public.add_group_member($1, $2, 'عضو', $3, false) as id", [
      owner,
      g.id,
      nextPhone(),
    ]);
    const slots = (
      await server<{ id: string }>("select id from public.group_slots where group_id = $1 order by payout_order", [g.id])
    ).map((r) => r.id);
    for (const s of slots) {
      await server("select public.set_slot_allocations($1, $2, $3::jsonb)", [
        owner,
        s,
        JSON.stringify([{ member_id: m.id, amount: "100" }]),
      ]);
    }
    await activate(owner, g.id);

    const reorder = (order: string[]) => server("select public.reorder_payouts($1, $2, $3)", [owner, g.id, order]);

    // Moving a started turn (position 1 ↔ 4) is refused.
    await expect(reorder([slots[3], slots[1], slots[2], slots[0]])).rejects.toThrow(/locked/);
    // Swapping the two future turns (3 ↔ 4) is fine.
    await reorder([slots[0], slots[1], slots[3], slots[2]]);
    const rows = await server<{ id: string }>(
      "select id from public.group_slots where group_id = $1 order by payout_order",
      [g.id],
    );
    expect(rows.map((r) => r.id)).toEqual([slots[0], slots[1], slots[3], slots[2]]);
  });
});
