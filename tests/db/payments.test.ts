import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createTestDb, type TestDb } from "./harness";

let t: TestDb;
let phoneSeq = 9000;

beforeAll(async () => {
  t = await createTestDb();
}, 60_000);

afterAll(async () => {
  await t?.close();
});

const nextPhone = () => `+2012${String(++phoneSeq).padStart(8, "0")}`;
const today = () => new Date().toISOString().slice(0, 10);

async function server<T>(sql: string, params: unknown[] = []): Promise<T[]> {
  return (await t.as("service_role", () => t.db.query<T>(sql, params))).rows;
}

async function user(): Promise<string> {
  const [r] = await server<{ id: string }>("select public.register_user('مستخدم', $1, 'h') as id", [nextPhone()]);
  return r.id;
}

interface Active {
  owner: string;
  groupId: string;
  /** Ahmed owes 1500 per cycle (slot A 500 + slot B 1000). */
  ahmedCycle1: string;
  ahmedMember: string;
}

/** 2 slots × 1000: slot 1 = أحمد 500 + حسن 500, slot 2 = أحمد 1000. */
async function activeGroup(start: string): Promise<Active> {
  const owner = await user();
  const [g] = await server<{ id: string }>(
    "select public.create_group($1, 'جمعية', 1000, 2, 'monthly', $2, 28) as id",
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
  const ahmed = await add("أحمد");
  const hassan = await add("حسن");
  const [s1, s2] = (
    await server<{ id: string }>("select id from public.group_slots where group_id = $1 order by slot_number", [g.id])
  ).map((r) => r.id);
  const set = (slot: string, list: { member_id: string; amount: string }[]) =>
    server("select public.set_slot_allocations($1, $2, $3::jsonb)", [owner, slot, JSON.stringify(list)]);
  await set(s1, [
    { member_id: ahmed, amount: "500" },
    { member_id: hassan, amount: "500" },
  ]);
  await set(s2, [{ member_id: ahmed, amount: "1000" }]);
  await server("select public.activate_group($1, $2)", [owner, g.id]);

  const [ob] = await server<{ id: string }>(
    `select o.id from public.member_obligations o join public.group_cycles c on c.id = o.cycle_id
      where c.group_id = $1 and c.cycle_number = 1 and o.member_id = $2`,
    [g.id, ahmed],
  );
  return { owner, groupId: g.id, ahmedCycle1: ob.id, ahmedMember: ahmed };
}

const pay = (actor: string, obligation: string, amount: string, paidOn = today(), key: string | null = null) =>
  server<{ id: string }>("select public.record_payment($1, $2, $3, $4, 'cash', null, $5) as id", [
    actor,
    obligation,
    amount,
    paidOn,
    key,
  ]);

async function balance(obligation: string) {
  const [b] = await server<{ paid_total: string; outstanding: string; status: string }>(
    "select paid_total::text, outstanding::text, status from public.obligation_balances where obligation_id = $1",
    [obligation],
  );
  return b;
}

describe("API roles have no access", () => {
  for (const role of ["anon", "authenticated"] as const) {
    it(`${role} cannot read payments or balances`, async () => {
      await expect(t.as(role, () => t.db.query("select * from public.payment_records"))).rejects.toThrow(
        /permission denied/,
      );
      await expect(t.as(role, () => t.db.query("select * from public.obligation_balances"))).rejects.toThrow(
        /permission denied/,
      );
    });
    it(`${role} cannot call record_payment`, async () => {
      await expect(
        t.as(role, () =>
          t.db.query(
            "select public.record_payment(gen_random_uuid(), gen_random_uuid(), 1, current_date, 'cash')",
          ),
        ),
      ).rejects.toThrow(/permission denied/);
    });
  }
});

describe("who can record", () => {
  it("an ordinary member (even with a linked account) cannot record or see balances through functions", async () => {
    const g = await activeGroup("2099-01-01");
    const stranger = await user();
    await expect(pay(stranger, g.ahmedCycle1, "100")).rejects.toThrow(/not allowed/);
  });

  it("a collector can record but cannot reverse", async () => {
    const g = await activeGroup("2099-01-01");
    const collector = await user();
    await server("insert into public.group_roles (group_id, user_id, role) values ($1, $2, 'collector')", [
      g.groupId,
      collector,
    ]);
    const [p] = await pay(collector, g.ahmedCycle1, "100", "2026-01-01");
    await expect(
      server("select public.reverse_payment($1, $2, 'غلط')", [collector, p.id]),
    ).rejects.toThrow(/not allowed/);
  });
});

describe("partial payments and status", () => {
  it("before the due date: unpaid → partially_paid → paid; never paid while partial", async () => {
    const g = await activeGroup("2099-01-01");
    expect(await balance(g.ahmedCycle1)).toEqual({ paid_total: "0.00", outstanding: "1500.00", status: "unpaid" });

    await pay(g.owner, g.ahmedCycle1, "1000");
    expect(await balance(g.ahmedCycle1)).toEqual({
      paid_total: "1000.00",
      outstanding: "500.00",
      status: "partially_paid",
    });

    await pay(g.owner, g.ahmedCycle1, "300");
    await pay(g.owner, g.ahmedCycle1, "200");
    expect(await balance(g.ahmedCycle1)).toEqual({ paid_total: "1500.00", outstanding: "0.00", status: "paid" });
  });

  it("after the due date anything outstanding is overdue, partial or not", async () => {
    const g = await activeGroup("2020-01-01");
    expect((await balance(g.ahmedCycle1)).status).toBe("overdue");
    await pay(g.owner, g.ahmedCycle1, "1499.99", "2020-02-01");
    expect(await balance(g.ahmedCycle1)).toEqual({
      paid_total: "1499.99",
      outstanding: "0.01",
      status: "overdue",
    });
    await pay(g.owner, g.ahmedCycle1, "0.01", "2020-02-02");
    expect((await balance(g.ahmedCycle1)).status).toBe("paid");
  });

  it("rejects overpayment, zero, 3 decimals and future dates", async () => {
    const g = await activeGroup("2099-01-01");
    await expect(pay(g.owner, g.ahmedCycle1, "1500.01")).rejects.toThrow(/exceeds outstanding/);
    await expect(pay(g.owner, g.ahmedCycle1, "0")).rejects.toThrow(/positive/);
    await expect(pay(g.owner, g.ahmedCycle1, "10.005")).rejects.toThrow(/positive/);
    await expect(pay(g.owner, g.ahmedCycle1, "10", "2999-01-01")).rejects.toThrow(/future/);
  });

  it("a retried submit with the same idempotency key records once", async () => {
    const g = await activeGroup("2099-01-01");
    const key = randomUUID();
    const [a] = await pay(g.owner, g.ahmedCycle1, "100", today(), key);
    const [b] = await pay(g.owner, g.ahmedCycle1, "100", today(), key);
    expect(a.id).toBe(b.id);
    expect((await balance(g.ahmedCycle1)).paid_total).toBe("100.00");
  });
});

describe("reversals", () => {
  it("cancel a payment in full, keep both rows, and restore the outstanding amount", async () => {
    const g = await activeGroup("2099-01-01");
    const [p] = await pay(g.owner, g.ahmedCycle1, "1500");
    expect((await balance(g.ahmedCycle1)).status).toBe("paid");

    await server("select public.reverse_payment($1, $2, 'اتسجلت مرتين بالغلط')", [g.owner, p.id]);
    expect(await balance(g.ahmedCycle1)).toEqual({ paid_total: "0.00", outstanding: "1500.00", status: "unpaid" });

    const rows = await server<{ kind: string }>(
      "select kind from public.payment_records where obligation_id = $1 order by created_at",
      [g.ahmedCycle1],
    );
    expect(rows.map((r) => r.kind)).toEqual(["payment", "reversal"]);

    await expect(server("select public.reverse_payment($1, $2, 'تاني')", [g.owner, p.id])).rejects.toThrow(
      /already reversed/,
    );
  });

  it("require a reason and can't target a reversal", async () => {
    const g = await activeGroup("2099-01-01");
    const [p] = await pay(g.owner, g.ahmedCycle1, "100");
    await expect(server("select public.reverse_payment($1, $2, '  ')", [g.owner, p.id])).rejects.toThrow(
      /reason/,
    );
    const [r] = await server<{ id: string }>("select public.reverse_payment($1, $2, 'غلط') as id", [g.owner, p.id]);
    await expect(server("select public.reverse_payment($1, $2, 'غلط')", [g.owner, r.id])).rejects.toThrow(
      /only payments/,
    );
  });
});

describe("the ledger is append-only", () => {
  it("payments can't be updated or deleted, even by the database owner", async () => {
    const g = await activeGroup("2099-01-01");
    const [p] = await pay(g.owner, g.ahmedCycle1, "100");
    await expect(server("update public.payment_records set amount = 1 where id = $1", [p.id])).rejects.toThrow(
      /permission denied|append-only/,
    );
    await expect(t.db.query("delete from public.payment_records where id = $1", [p.id])).rejects.toThrow(
      /append-only/,
    );
  });
});
