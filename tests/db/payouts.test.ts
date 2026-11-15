import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { splitPot } from "@/lib/money";
import { createTestDb, type TestDb } from "./harness";

let t: TestDb;
let phoneSeq = 20000;

beforeAll(async () => {
  t = await createTestDb();
}, 60_000);

afterAll(async () => {
  await t?.close();
});

const nextPhone = () => `+2015${String(++phoneSeq).padStart(8, "0")}`;
const today = () => new Date().toISOString().slice(0, 10);

async function server<T>(sql: string, params: unknown[] = []): Promise<T[]> {
  return (await t.as("service_role", () => t.db.query<T>(sql, params))).rows;
}

async function user(): Promise<string> {
  const [r] = await server<{ id: string }>("select public.register_user('مستخدم', $1, 'h') as id", [nextPhone()]);
  return r.id;
}

/**
 * 3 slots × 1000 → pot 3000.
 * slot 1 (turn 1): إبراهيم 750 + أسامة 250 · slot 2: محمد · slot 3: محمد.
 */
async function startedGroup(start = "2020-01-01") {
  const owner = await user();
  const [g] = await server<{ id: string }>(
    "select public.create_group($1, 'جمعية', 1000, 3, 'monthly', $2, 5) as id",
    [owner, start],
  );
  const add = async (name: string) =>
    (
      await server<{ id: string }>("select public.add_group_member($1, $2, $3, $4, false) as id", [
        owner,
        g.id,
        name,
        nextPhone(),
      ])
    )[0].id;
  const ibrahim = await add("إبراهيم");
  const osama = await add("أسامة");
  const mohamed = await add("محمد");
  const slots = (
    await server<{ id: string }>("select id from public.group_slots where group_id = $1 order by slot_number", [g.id])
  ).map((r) => r.id);
  const set = (slot: string, list: [string, string][]) =>
    server("select public.set_slot_allocations($1, $2, $3::jsonb)", [
      owner,
      slot,
      JSON.stringify(list.map(([member_id, amount]) => ({ member_id, amount }))),
    ]);
  await set(slots[0], [
    [ibrahim, "750"],
    [osama, "250"],
  ]);
  await set(slots[1], [[mohamed, "1000"]]);
  await set(slots[2], [[mohamed, "1000"]]);
  await server("select public.activate_group($1, $2)", [owner, g.id]);

  const cycles = (
    await server<{ id: string }>("select id from public.group_cycles where group_id = $1 order by cycle_number", [g.id])
  ).map((r) => r.id);
  return { owner, groupId: g.id, cycles, ibrahim, osama, mohamed };
}

const ensure = (actor: string, cycle: string) =>
  server<{ id: string }>("select public.ensure_payout($1, $2) as id", [actor, cycle]);

async function allocations(payoutId: string) {
  return server<{ id: string; member_id: string; expected_amount: string }>(
    // order by the numeric column, not the ::text alias
    "select id, member_id, expected_amount::text from public.payout_allocations pa where payout_id = $1 order by pa.share_amount desc",
    [payoutId],
  );
}

const disburse = (actor: string, allocationId: string, amount: string, paidOn = today()) =>
  server<{ id: string }>(
    "select public.record_payout_disbursement($1, $2, $3, $4, 'cash') as id",
    [actor, allocationId, amount, paidOn],
  );

async function status(allocationId: string) {
  const [b] = await server<{ paid_total: string; outstanding: string; status: string }>(
    "select paid_total::text, outstanding::text, status from public.payout_allocation_balances where payout_allocation_id = $1",
    [allocationId],
  );
  return b;
}

describe("API roles have no access", () => {
  for (const role of ["anon", "authenticated"] as const) {
    for (const table of ["payout_records", "payout_allocations", "payout_disbursements", "payout_allocation_balances"]) {
      it(`${role} cannot read ${table}`, async () => {
        await expect(t.as(role, () => t.db.query(`select * from public.${table}`))).rejects.toThrow(
          /permission denied/,
        );
      });
    }
    it(`${role} cannot call ensure_payout`, async () => {
      await expect(
        t.as(role, () => t.db.query("select public.ensure_payout(gen_random_uuid(), gen_random_uuid())")),
      ).rejects.toThrow(/permission denied/);
    });
  }
});

describe("ensure_payout", () => {
  it("snapshots the turn's slot and splits the pot by share (750/250 of 3,000 → 2,250/750)", async () => {
    const g = await startedGroup();
    const [p] = await ensure(g.owner, g.cycles[0]);

    const [payout] = await server<{ expected_amount: string }>(
      "select expected_amount::text from public.payout_records where id = $1",
      [p.id],
    );
    expect(payout.expected_amount).toBe("3000.00");

    const rows = await allocations(p.id);
    expect(rows.map((r) => [r.member_id, r.expected_amount])).toEqual([
      [g.ibrahim, "2250.00"],
      [g.osama, "750.00"],
    ]);
    // Same numbers as the app's splitPot.
    expect(rows.map((r) => r.expected_amount)).toEqual(splitPot("3000", "1000", ["750", "250"]));
  });

  it("is idempotent: a second call returns the same payout", async () => {
    const g = await startedGroup();
    const [a] = await ensure(g.owner, g.cycles[0]);
    const [b] = await ensure(g.owner, g.cycles[0]);
    expect(a.id).toBe(b.id);
  });

  it("follows the payout order at the time (cycle 2 pays position 2)", async () => {
    const g = await startedGroup();
    const [p] = await ensure(g.owner, g.cycles[1]);
    const rows = await allocations(p.id);
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ member_id: g.mohamed, expected_amount: "3000.00" });
  });

  it("refuses cycles that haven't started, and non-admins (collectors included)", async () => {
    const future = await startedGroup("2099-01-01");
    await expect(ensure(future.owner, future.cycles[0])).rejects.toThrow(/not started/);

    const g = await startedGroup();
    const collector = await user();
    await server("insert into public.group_roles (group_id, user_id, role) values ($1, $2, 'collector')", [
      g.groupId,
      collector,
    ]);
    await expect(ensure(collector, g.cycles[0])).rejects.toThrow(/not allowed/);
  });
});

describe("disbursements", () => {
  it("pending → partially_paid → paid per owner; never more than the entitlement", async () => {
    const g = await startedGroup();
    const [p] = await ensure(g.owner, g.cycles[0]);
    const [ibrahim] = await allocations(p.id);

    expect(await status(ibrahim.id)).toEqual({ paid_total: "0.00", outstanding: "2250.00", status: "pending" });
    await disburse(g.owner, ibrahim.id, "1000");
    expect((await status(ibrahim.id)).status).toBe("partially_paid");
    await expect(disburse(g.owner, ibrahim.id, "1250.01")).rejects.toThrow(/exceeds/);
    await disburse(g.owner, ibrahim.id, "1250");
    expect(await status(ibrahim.id)).toEqual({ paid_total: "2250.00", outstanding: "0.00", status: "paid" });
  });

  it("future dates and non-admins are refused", async () => {
    const g = await startedGroup();
    const [p] = await ensure(g.owner, g.cycles[0]);
    const [a] = await allocations(p.id);
    await expect(disburse(g.owner, a.id, "10", "2999-01-01")).rejects.toThrow(/future/);
    const stranger = await user();
    await expect(disburse(stranger, a.id, "10")).rejects.toThrow(/not allowed/);
  });

  it("a reversal cancels one disbursement and keeps both rows", async () => {
    const g = await startedGroup();
    const [p] = await ensure(g.owner, g.cycles[0]);
    const [, osama] = await allocations(p.id);
    const [d] = await disburse(g.owner, osama.id, "750");
    expect((await status(osama.id)).status).toBe("paid");

    await server("select public.reverse_payout_disbursement($1, $2, 'اتسلّم لحد غلط')", [g.owner, d.id]);
    expect(await status(osama.id)).toEqual({ paid_total: "0.00", outstanding: "750.00", status: "pending" });
    await expect(
      server("select public.reverse_payout_disbursement($1, $2, 'تاني')", [g.owner, d.id]),
    ).rejects.toThrow(/already reversed/);
  });

  it("snapshots and ledger can't be changed or deleted", async () => {
    const g = await startedGroup();
    const [p] = await ensure(g.owner, g.cycles[0]);
    const [a] = await allocations(p.id);
    const [d] = await disburse(g.owner, a.id, "100");
    await expect(t.db.query("update public.payout_allocations set expected_amount = 1 where id = $1", [a.id])).rejects.toThrow(
      /immutable/,
    );
    await expect(t.db.query("delete from public.payout_disbursements where id = $1", [d.id])).rejects.toThrow(
      /immutable/,
    );
    await expect(t.db.query("delete from public.payout_records where id = $1", [p.id])).rejects.toThrow(/immutable/);
  });
});
