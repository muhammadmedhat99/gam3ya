import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createTestDb, type TestDb } from "./harness";

let t: TestDb;
let phoneSeq = 40000;

beforeAll(async () => {
  t = await createTestDb();
}, 60_000);

afterAll(async () => {
  await t?.close();
});

const nextPhone = () => `+2011${String(++phoneSeq).padStart(8, "0")}`;
const isoDaysFromToday = (days: number) => new Date(Date.now() + days * 86400000).toISOString().slice(0, 10);

async function server<T>(sql: string, params: unknown[] = []): Promise<T[]> {
  return (await t.as("service_role", () => t.db.query<T>(sql, params))).rows;
}

async function user(name = "مستخدم", phone = nextPhone()): Promise<{ id: string; phone: string }> {
  const [r] = await server<{ id: string }>("select public.register_user($1, $2, 'h') as id", [name, phone]);
  return { id: r.id, phone };
}

async function inbox(userId: string) {
  return server<{ type: string; group_id: string | null; title: string; body: string }>(
    "select type, group_id, title, body from public.notifications where user_id = $1 order by created_at",
    [userId],
  );
}

/** Group with one linked member owning every slot; returns ids. */
async function setup(opts: { slots?: number; start?: string; frequency?: string; due?: number } = {}) {
  const owner = await user("صاحب");
  const [g] = await server<{ id: string }>(
    "select public.create_group($1, 'جمعية العيلة', 1000, $2, $3, $4, $5) as id",
    [owner.id, opts.slots ?? 2, opts.frequency ?? "monthly", opts.start ?? "2099-01-01", opts.due ?? 5],
  );
  const member = await user("أحمد");
  const [m] = await server<{ id: string }>("select public.add_group_member($1, $2, 'أحمد', $3, true) as id", [
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
  return { owner: owner.id, member: member.id, memberRow: m.id, groupId: g.id };
}

describe("access", () => {
  for (const role of ["anon", "authenticated"] as const) {
    it(`${role} cannot read notifications or run notify_daily`, async () => {
      await expect(t.as(role, () => t.db.query("select * from public.notifications"))).rejects.toThrow(/permission denied/);
      await expect(t.as(role, () => t.db.query("select public.notify_daily()"))).rejects.toThrow(/permission denied/);
    });
  }
});

describe("event notifications", () => {
  it("adding a linked member notifies them", async () => {
    const { member } = await setup();
    expect((await inbox(member)).map((n) => n.type)).toEqual(["member_added"]);
  });

  it("a registration with an added phone notifies the admins; approval notifies the user", async () => {
    const owner = await user("صاحب");
    const [g] = await server<{ id: string }>(
      "select public.create_group($1, 'جمعية الجيران', 500, 3, 'monthly', '2099-01-01', 5) as id",
      [owner.id],
    );
    const phone = nextPhone();
    await server("select public.add_group_member($1, $2, 'هبة', $3, false)", [owner.id, g.id, phone]);
    const heba = await user("هبة الله", phone);

    const ownerInbox = await inbox(owner.id);
    expect(ownerInbox.map((n) => n.type)).toEqual(["link_request"]);
    expect(ownerInbox[0].body).toContain("هبة الله");

    const [req] = await server<{ id: string }>("select id from public.member_link_requests where user_id = $1", [heba.id]);
    await server("select public.review_link_request($1, $2, true)", [owner.id, req.id]);
    const [approved] = await inbox(heba.id);
    expect(approved).toMatchObject({ type: "link_approved", group_id: g.id });
  });

  it("a rejection doesn't name the association", async () => {
    const owner = await user("صاحب");
    const [g] = await server<{ id: string }>(
      "select public.create_group($1, 'جمعية سرية', 500, 3, 'monthly', '2099-01-01', 5) as id",
      [owner.id],
    );
    const phone = nextPhone();
    await server("select public.add_group_member($1, $2, 'عمرو', $3, false)", [owner.id, g.id, phone]);
    const amr = await user("عمرو", phone);
    const [req] = await server<{ id: string }>("select id from public.member_link_requests where user_id = $1", [amr.id]);
    await server("select public.review_link_request($1, $2, false)", [owner.id, req.id]);

    const [n] = await inbox(amr.id);
    expect(n.type).toBe("link_rejected");
    expect(n.group_id).toBeNull();
    expect(n.body).not.toContain("سرية");
  });

  it("starting the group notifies members but not the admin who started it", async () => {
    const { owner, member, groupId } = await setup();
    await server("select public.activate_group($1, $2)", [owner, groupId]);
    expect((await inbox(member)).map((n) => n.type)).toContain("group_started");
    expect((await inbox(owner)).map((n) => n.type)).not.toContain("group_started");
  });

  it("recording a member's payment never notifies members; recording their payout does", async () => {
    const { owner, member, memberRow, groupId } = await setup({ start: "2020-01-01" });
    await server("select public.activate_group($1, $2)", [owner, groupId]);
    const [ob] = await server<{ id: string }>(
      `select o.id from public.member_obligations o join public.group_cycles c on c.id = o.cycle_id
        where c.group_id = $1 and c.cycle_number = 1 and o.member_id = $2`,
      [groupId, memberRow],
    );
    await server("select public.record_payment($1, $2, 100, '2020-01-02', 'cash')", [owner, ob.id]);
    expect((await inbox(member)).map((n) => n.type)).not.toContain("payment_recorded");

    const [cycle] = await server<{ id: string }>(
      "select id from public.group_cycles where group_id = $1 and cycle_number = 1",
      [groupId],
    );
    const [p] = await server<{ id: string }>("select public.ensure_payout($1, $2) as id", [owner, cycle.id]);
    const [a] = await server<{ id: string }>("select id from public.payout_allocations where payout_id = $1", [p.id]);
    await server("select public.record_payout_disbursement($1, $2, 100, current_date, 'cash')", [owner, a.id]);
    const types = (await inbox(member)).map((n) => n.type);
    expect(types).toContain("payout_recorded");
    expect(types.every((x) => !["overdue", "due_tomorrow"].includes(x))).toBe(true);
  });
});

describe("notify_daily", () => {
  it("'دورك قرّب' 3 days before the turn, once", async () => {
    const { owner, member, groupId } = await setup({ start: isoDaysFromToday(3) });
    await server("select public.activate_group($1, $2)", [owner, groupId]);
    await server("select public.notify_daily()");
    await server("select public.notify_daily()");
    const soon = (await inbox(member)).filter((n) => n.type === "turn_soon");
    expect(soon).toHaveLength(1);
  });

  it("overdue reminder goes to staff only, the day after the deadline", async () => {
    const { owner, member, groupId } = await setup({ start: isoDaysFromToday(-1), frequency: "semi_monthly", due: 0 });
    await server("select public.activate_group($1, $2)", [owner, groupId]);
    await server("select public.notify_daily()");
    expect((await inbox(owner)).map((n) => n.type)).toContain("overdue");
    expect((await inbox(member)).map((n) => n.type)).not.toContain("overdue");
  });
});
