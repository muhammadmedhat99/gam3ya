import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createTestDb, type TestDb } from "./harness";

let t: TestDb;
let phoneSeq = 70000;

beforeAll(async () => {
  t = await createTestDb();
}, 60_000);

afterAll(async () => {
  await t?.close();
});

const nextPhone = () => `+2015${String(++phoneSeq).padStart(8, "0")}`;
const yesterday = () => new Date(Date.now() - 86400000).toISOString().slice(0, 10);

async function server<T>(sql: string, params: unknown[] = []): Promise<T[]> {
  return (await t.as("service_role", () => t.db.query<T>(sql, params))).rows;
}

async function owner(): Promise<string> {
  const [r] = await server<{ id: string }>("select public.register_user('صاحب', $1, 'h') as id", [nextPhone()]);
  return r.id;
}

/**
 * N slots × 1000, one owner per slot (names A, B, C, …), optionally one slot shared.
 * Start yesterday → only cycle 1 has started (monthly).
 */
async function setup(
  n: number,
  opts: { activate?: boolean; shared?: boolean; start?: string; semiMonthly?: boolean } = {},
) {
  const ownerId = await owner();
  const [g] = await server<{ id: string }>(
    "select public.create_group($1, 'جمعية', 1000, $2, $3, $4, $5) as id",
    [ownerId, n, opts.semiMonthly ? "semi_monthly" : "monthly", opts.start ?? yesterday(), opts.semiMonthly ? 0 : 28],
  );
  const names = "ABCDEFGH".slice(0, n).split("");
  const members: Record<string, string> = {};
  for (const name of [...names, "Z"]) {
    const [m] = await server<{ id: string }>("select public.add_group_member($1, $2, $3, $4, false) as id", [
      ownerId,
      g.id,
      name,
      nextPhone(),
    ]);
    members[name] = m.id;
  }
  const slots = (
    await server<{ id: string }>("select id from public.group_slots where group_id = $1 order by slot_number", [g.id])
  ).map((r) => r.id);
  for (const [i, name] of names.entries()) {
    const list =
      opts.shared && i === 2
        ? [
            { member_id: members[name], amount: "250" },
            { member_id: members.Z, amount: "750" },
          ]
        : [{ member_id: members[name], amount: "1000" }];
    await server("select public.set_slot_allocations($1, $2, $3::jsonb)", [ownerId, slots[i], JSON.stringify(list)]);
  }
  if (opts.activate) await server("select public.activate_group($1, $2)", [ownerId, g.id]);
  return { owner: ownerId, groupId: g.id, members, slots };
}

const remove = (actor: string, member: string, replacement: string | null = null) =>
  server<{ mode: string }>("select public.remove_group_member($1, $2, $3, 'سبب') as mode", [actor, member, replacement]);

async function order(groupId: string) {
  return server<{ slot_number: number; owners: string }>(
    `select s.slot_number, string_agg(m.display_name || ':' || a.amount::int, '+' order by m.display_name) as owners
       from public.group_slots s
       join public.slot_allocations a on a.slot_id = s.id
       join public.group_members m on m.id = a.member_id
      where s.group_id = $1 and s.status <> 'inactive'
      group by s.slot_number order by s.slot_number`,
    [groupId],
  );
}

async function pots(groupId: string) {
  return server<{ cycle_number: number; pot: string }>(
    `select cycle_number, sum(amount_due)::text as pot from public.obligation_balances
      where group_id = $1 group by cycle_number order by cycle_number`,
    [groupId],
  );
}

describe("access", () => {
  it("anon/authenticated can't call remove_group_member", async () => {
    for (const role of ["anon", "authenticated"] as const) {
      await expect(
        t.as(role, () => t.db.query("select public.remove_group_member(gen_random_uuid(), gen_random_uuid())")),
      ).rejects.toThrow(/permission denied/);
    }
  });
});

describe("draft", () => {
  it("removes the member; their name becomes short", async () => {
    const g = await setup(3);
    const [r] = await remove(g.owner, g.members.B);
    expect(r.mode).toBe("removed");
    const [m] = await server<{ status: string }>("select status from public.group_members where id = $1", [g.members.B]);
    expect(m.status).toBe("removed");
    expect((await order(g.groupId)).map((o) => o.slot_number)).toEqual([1, 3]); // slot 2 has no owners now
  });

  it("can hand the shares to a replacement", async () => {
    const g = await setup(3);
    const [r] = await remove(g.owner, g.members.B, g.members.Z);
    expect(r.mode).toBe("replaced");
    expect(await order(g.groupId)).toEqual([
      { slot_number: 1, owners: "A:1000" },
      { slot_number: 2, owners: "Z:1000" },
      { slot_number: 3, owners: "C:1000" },
    ]);
  });
});

describe("started group", () => {
  it("refuses a member who already paid", async () => {
    const g = await setup(3, { activate: true });
    const [ob] = await server<{ id: string }>(
      "select obligation_id as id from public.obligation_balances where member_id = $1 and cycle_number = 1",
      [g.members.C],
    );
    await server("select public.record_payment($1, $2, 1, current_date - 1, 'cash')", [g.owner, ob.id]);
    await expect(remove(g.owner, g.members.C)).rejects.toThrow(/already paid/);
  });

  it("refuses a member whose turn already came", async () => {
    const g = await setup(3, { activate: true });
    await expect(remove(g.owner, g.members.A)).rejects.toThrow(/turn already came/);
  });

  it("shrink: the 3rd leaves, the 4th moves up, the group has one name less", async () => {
    const g = await setup(4, { activate: true });
    const [r] = await remove(g.owner, g.members.C);
    expect(r.mode).toBe("shrunk");

    expect(await order(g.groupId)).toEqual([
      { slot_number: 1, owners: "A:1000" },
      { slot_number: 2, owners: "B:1000" },
      { slot_number: 3, owners: "D:1000" },
    ]);
    // 3 cycles left, each pot 3,000; cycle 4 cancelled and gone from balances.
    expect(await pots(g.groupId)).toEqual([
      { cycle_number: 1, pot: "3000.00" },
      { cycle_number: 2, pot: "3000.00" },
      { cycle_number: 3, pot: "3000.00" },
    ]);
    const [grp] = await server<{ target_slot_count: number }>("select target_slot_count from public.groups where id = $1", [g.groupId]);
    expect(grp.target_slot_count).toBe(3);

    // C's dues are cancelled, not deleted.
    const cancelled = await server<{ status: string }>(
      "select status from public.obligation_balances where member_id = $1",
      [g.members.C],
    );
    expect(cancelled.every((x) => x.status === "cancelled")).toBe(true);
    const snapshot = await server("select 1 from public.member_obligations where member_id = $1", [g.members.C]);
    expect(snapshot).toHaveLength(4);
  });

  it("a shared name needs a replacement; the replacement takes the share and every due", async () => {
    const g = await setup(4, { activate: true, shared: true }); // slot 3 = C 250 + Z 750
    await expect(remove(g.owner, g.members.C)).rejects.toThrow(/needs a replacement/);

    await remove(g.owner, g.members.C, g.members.Z);
    expect((await order(g.groupId))[2]).toEqual({ slot_number: 3, owners: "Z:1000" });

    // Pot unchanged (4,000) and Z now owes 1,000 per cycle.
    expect((await pots(g.groupId)).every((p) => p.pot === "4000.00")).toBe(true);
    const zDue = await server<{ amount_due: string }>(
      "select amount_due::text from public.obligation_balances where member_id = $1 order by cycle_number",
      [g.members.Z],
    );
    expect(zDue.map((d) => d.amount_due)).toEqual(["1000.00", "1000.00", "1000.00", "1000.00"]);
  });

  it("a new replacement (no dues yet) gets the removed member's dues", async () => {
    const g = await setup(3, { activate: true });
    const [fresh] = await server<{ id: string }>("select public.add_group_member($1, $2, 'جديد', $3, false) as id", [
      g.owner,
      g.groupId,
      nextPhone(),
    ]);
    await remove(g.owner, g.members.C, fresh.id);
    const due = await server<{ amount_due: string }>(
      "select amount_due::text from public.obligation_balances where member_id = $1",
      [fresh.id],
    );
    expect(due.map((d) => d.amount_due)).toEqual(["1000.00", "1000.00", "1000.00"]);
  });

  it("can't shrink below 2 names", async () => {
    const g = await setup(2, { activate: true });
    await expect(remove(g.owner, g.members.B)).rejects.toThrow(/at least 2 names/);
  });

  it("payments and payouts use the effective dues; completion ignores cancelled cycles", async () => {
    // Every 15 days, started 16 days ago: cycles 1 and 2 started, cycle 3 is in the future.
    const start = new Date(Date.now() - 16 * 86400000).toISOString().slice(0, 10);
    const g = await setup(3, { activate: true, start, semiMonthly: true });
    await remove(g.owner, g.members.C); // 2 names left, cycle 3 cancelled

    const [cOb] = await server<{ id: string }>(
      "select o.id from public.member_obligations o join public.group_cycles c on c.id = o.cycle_id where o.member_id = $1 and c.cycle_number = 1",
      [g.members.C],
    );
    await expect(
      server("select public.record_payment($1, $2, 1, current_date - 1, 'cash')", [g.owner, cOb.id]),
    ).rejects.toThrow(/exceeds outstanding/);

    const [c1] = await server<{ id: string }>("select id from public.group_cycles where group_id = $1 and cycle_number = 1", [g.groupId]);
    const [p] = await server<{ id: string }>("select public.ensure_payout($1, $2) as id", [g.owner, c1.id]);
    const [payout] = await server<{ expected_amount: string }>("select expected_amount::text from public.payout_records where id = $1", [p.id]);
    expect(payout.expected_amount).toBe("2000.00");

    const [c3] = await server<{ id: string }>("select id from public.group_cycles where group_id = $1 and cycle_number = 3", [g.groupId]);
    await expect(server("select public.ensure_payout($1, $2)", [g.owner, c3.id])).rejects.toThrow(/cancelled/);

    await server("select public.complete_group($1, $2)", [g.owner, g.groupId]);
    const [grp] = await server<{ status: string }>("select status from public.groups where id = $1", [g.groupId]);
    expect(grp.status).toBe("completed");
  });

  it("only the owner can remove an admin", async () => {
    const g = await setup(3);
    const admin = await owner();
    const phone = nextPhone();
    await server("update public.users set phone_e164 = $1 where id = $2", [phone, admin]);
    const [m] = await server<{ id: string }>("select public.add_group_member($1, $2, 'أدمن', $3, true) as id", [g.owner, g.groupId, phone]);
    await server("select public.set_group_role($1, $2, $3, 'admin')", [g.owner, g.groupId, admin]);
    const other = await owner();
    const p2 = nextPhone();
    await server("update public.users set phone_e164 = $1 where id = $2", [p2, other]);
    const [m2] = await server<{ id: string }>("select public.add_group_member($1, $2, 'أدمن2', $3, true) as id", [g.owner, g.groupId, p2]);
    await server("select public.set_group_role($1, $2, $3, 'admin')", [g.owner, g.groupId, other]);

    await expect(remove(admin, m2.id)).rejects.toThrow(/only the owner/);
    await remove(g.owner, m.id);
    const roles = await server("select 1 from public.group_roles where group_id = $1 and user_id = $2", [g.groupId, admin]);
    expect(roles).toHaveLength(0);
  });
});
