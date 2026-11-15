import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createTestDb, type TestDb } from "./harness";

let t: TestDb;
let phoneSeq = 0;

beforeAll(async () => {
  t = await createTestDb();
}, 60_000);

afterAll(async () => {
  await t?.close();
});

function nextPhone(): string {
  phoneSeq += 1;
  return `+2010${String(phoneSeq).padStart(8, "0")}`;
}

/** Runs SQL as the server (service_role) and returns rows. */
async function server<T>(sql: string, params: unknown[] = []): Promise<T[]> {
  const res = await t.as("service_role", () => t.db.query<T>(sql, params));
  return res.rows;
}

async function createUser(name = "مستخدم", phone = nextPhone()): Promise<{ id: string; phone: string }> {
  const [row] = await server<{ id: string }>(
    "select public.register_user($1, $2, 'hash') as id",
    [name, phone],
  );
  return { id: row.id, phone };
}

async function createGroup(ownerId: string, slots = 3, amount = "1000.00"): Promise<string> {
  const [row] = await server<{ id: string }>(
    "select public.create_group($1, 'جمعية العيلة', $2, $3, 'monthly', '2027-01-01', 5) as id",
    [ownerId, amount, slots],
  );
  return row.id;
}

async function addMember(
  actorId: string,
  groupId: string,
  name: string,
  phone: string | null = nextPhone(),
  confirm = false,
): Promise<string> {
  const [row] = await server<{ id: string }>(
    "select public.add_group_member($1, $2, $3, $4, $5) as id",
    [actorId, groupId, name, phone, confirm],
  );
  return row.id;
}

async function slotIds(groupId: string): Promise<string[]> {
  const rows = await server<{ id: string }>(
    "select id from public.group_slots where group_id = $1 order by slot_number",
    [groupId],
  );
  return rows.map((r) => r.id);
}

const NEW_TABLES = [
  "groups",
  "group_members",
  "group_roles",
  "member_link_requests",
  "group_slots",
  "slot_allocations",
];

describe("API roles have no access", () => {
  for (const role of ["anon", "authenticated"] as const) {
    for (const table of NEW_TABLES) {
      it(`${role} cannot read ${table}`, async () => {
        await expect(t.as(role, () => t.db.query(`select * from public.${table}`))).rejects.toThrow(
          /permission denied/,
        );
      });
    }
    it(`${role} cannot call create_group`, async () => {
      await expect(
        t.as(role, () =>
          t.db.query(
            "select public.create_group(gen_random_uuid(), 'x', 1000, 3, 'monthly', '2027-01-01', 5)",
          ),
        ),
      ).rejects.toThrow(/permission denied/);
    });
  }
});

describe("create_group", () => {
  it("creates a draft group, the owner role and N slots ordered 1..N", async () => {
    const owner = await createUser("صاحب الجمعية");
    const groupId = await createGroup(owner.id, 4);

    const [group] = await server<{ status: string; owner_user_id: string }>(
      "select status, owner_user_id from public.groups where id = $1",
      [groupId],
    );
    expect(group).toEqual({ status: "draft", owner_user_id: owner.id });

    const roles = await server<{ role: string }>(
      "select role from public.group_roles where group_id = $1 and user_id = $2",
      [groupId, owner.id],
    );
    expect(roles).toEqual([{ role: "owner" }]);

    const slots = await server<{ slot_number: number; payout_order: number }>(
      "select slot_number, payout_order from public.group_slots where group_id = $1 order by slot_number",
      [groupId],
    );
    expect(slots).toEqual([1, 2, 3, 4].map((n) => ({ slot_number: n, payout_order: n })));
  });

  it("validates the due day against the frequency", async () => {
    const owner = await createUser();
    await expect(
      server("select public.create_group($1, 'x y', 1000, 3, 'monthly', '2027-01-01', 30)", [owner.id]),
    ).rejects.toThrow(/groups_due_day_matches_frequency/);
    await expect(
      server("select public.create_group($1, 'x y', 1000, 3, 'semi_monthly', '2027-01-01', 20)", [owner.id]),
    ).rejects.toThrow(/groups_due_day_matches_frequency/);
  });

  it("rejects amounts with more than 2 decimals", async () => {
    const owner = await createUser();
    await expect(createGroup(owner.id, 3, "1000.005")).rejects.toThrow(/2 decimals/);
  });

  it("locks money and schedule settings once the group is active", async () => {
    const owner = await createUser();
    const groupId = await createGroup(owner.id);
    await server("update public.groups set status = 'active' where id = $1", [groupId]);
    await expect(
      server("update public.groups set slot_amount = 2000 where id = $1", [groupId]),
    ).rejects.toThrow(/locked/);
    // The name can still change.
    await server("update public.groups set name = 'اسم جديد' where id = $1", [groupId]);
  });
});

describe("add_group_member", () => {
  it("only an owner/admin (or super admin) can add members", async () => {
    const owner = await createUser();
    const stranger = await createUser();
    const groupId = await createGroup(owner.id);
    await expect(addMember(stranger.id, groupId, "حد")).rejects.toThrow(/not allowed/);
  });

  it("adds an unlinked member when the phone has no account", async () => {
    const owner = await createUser();
    const groupId = await createGroup(owner.id);
    const memberId = await addMember(owner.id, groupId, "أسامة");
    const [m] = await server<{ user_id: string | null }>(
      "select user_id from public.group_members where id = $1",
      [memberId],
    );
    expect(m.user_id).toBeNull();
  });

  it("requires explicit confirmation when the phone already has an account, then links", async () => {
    const owner = await createUser();
    const ahmed = await createUser("أحمد علي");
    const groupId = await createGroup(owner.id);

    await expect(addMember(owner.id, groupId, "أحمد", ahmed.phone, false)).rejects.toThrow(
      /phone_has_account/,
    );

    const memberId = await addMember(owner.id, groupId, "أحمد", ahmed.phone, true);
    const [m] = await server<{ user_id: string }>(
      "select user_id from public.group_members where id = $1",
      [memberId],
    );
    expect(m.user_id).toBe(ahmed.id);
  });

  it("rejects the same phone twice in one group", async () => {
    const owner = await createUser();
    const groupId = await createGroup(owner.id);
    const phone = nextPhone();
    await addMember(owner.id, groupId, "حسن", phone);
    await expect(addMember(owner.id, groupId, "حسن تاني", phone)).rejects.toThrow(/duplicate key/);
  });
});

describe("registration and link requests", () => {
  it("registering with an added phone creates a pending request and does NOT link", async () => {
    const owner = await createUser();
    const groupA = await createGroup(owner.id);
    const groupB = await createGroup(owner.id);
    const phone = nextPhone();
    const memberA = await addMember(owner.id, groupA, "هبة", phone);
    const memberB = await addMember(owner.id, groupB, "هبة", phone);

    const heba = await createUser("هبة الله سامي", phone);

    const members = await server<{ user_id: string | null }>(
      "select user_id from public.group_members where id = any($1)",
      [[memberA, memberB]],
    );
    expect(members.every((m) => m.user_id === null)).toBe(true);

    const requests = await server<{ group_id: string; status: string }>(
      "select group_id, status from public.member_link_requests where user_id = $1 order by group_id",
      [heba.id],
    );
    expect(requests).toHaveLength(2);
    expect(requests.every((r) => r.status === "pending")).toBe(true);
  });

  it("no request for removed members or closed groups", async () => {
    const owner = await createUser();
    const open = await createGroup(owner.id);
    const closed = await createGroup(owner.id);
    const phone = nextPhone();
    const removed = await addMember(owner.id, open, "عمرو", phone);
    await server("update public.group_members set status = 'removed' where id = $1", [removed]);
    await addMember(owner.id, closed, "عمرو", phone);
    await server("update public.groups set status = 'cancelled' where id = $1", [closed]);

    const amr = await createUser("عمرو خالد", phone);
    const requests = await server("select 1 from public.member_link_requests where user_id = $1", [
      amr.id,
    ]);
    expect(requests).toHaveLength(0);
  });

  async function pendingRequest(): Promise<{ groupId: string; ownerId: string; requestId: string; userId: string; memberId: string }> {
    const owner = await createUser();
    const groupId = await createGroup(owner.id);
    const phone = nextPhone();
    const memberId = await addMember(owner.id, groupId, "عمرو", phone);
    const user = await createUser("عمرو خالد", phone);
    const [req] = await server<{ id: string }>(
      "select id from public.member_link_requests where member_id = $1",
      [memberId],
    );
    return { groupId, ownerId: owner.id, requestId: req.id, userId: user.id, memberId };
  }

  it("a non-manager cannot review, even the requesting user", async () => {
    const { requestId, userId } = await pendingRequest();
    await expect(
      server("select public.review_link_request($1, $2, true)", [userId, requestId]),
    ).rejects.toThrow(/not allowed/);
  });

  it("approval links the member, audits, and can't be repeated", async () => {
    const { requestId, ownerId, userId, memberId } = await pendingRequest();
    await server("select public.review_link_request($1, $2, true)", [ownerId, requestId]);

    const [m] = await server<{ user_id: string }>(
      "select user_id from public.group_members where id = $1",
      [memberId],
    );
    expect(m.user_id).toBe(userId);

    const log = await server("select 1 from public.activity_logs where entity_id = $1 and action = 'link_request.approved'", [requestId]);
    expect(log).toHaveLength(1);

    await expect(
      server("select public.review_link_request($1, $2, true)", [ownerId, requestId]),
    ).rejects.toThrow(/already reviewed/);
  });

  it("rejection leaves the member unlinked", async () => {
    const { requestId, ownerId, memberId } = await pendingRequest();
    await server("select public.review_link_request($1, $2, false)", [ownerId, requestId]);
    const [m] = await server<{ user_id: string | null }>(
      "select user_id from public.group_members where id = $1",
      [memberId],
    );
    expect(m.user_id).toBeNull();
  });

  it("the super admin can review in any group", async () => {
    const { requestId, memberId, userId } = await pendingRequest();
    const admin = await createUser("صاحب التطبيق");
    await t.db.query("update public.users set is_super_admin = true where id = $1", [admin.id]);
    await server("select public.review_link_request($1, $2, true)", [admin.id, requestId]);
    const [m] = await server<{ user_id: string }>(
      "select user_id from public.group_members where id = $1",
      [memberId],
    );
    expect(m.user_id).toBe(userId);
  });
});

describe("set_slot_allocations", () => {
  async function setup() {
    const owner = await createUser();
    const groupId = await createGroup(owner.id, 3);
    const ibrahim = await addMember(owner.id, groupId, "إبراهيم");
    const osama = await addMember(owner.id, groupId, "أسامة");
    const [slot1] = await slotIds(groupId);
    return { owner, groupId, ibrahim, osama, slot1 };
  }

  const set = (actor: string, slot: string, allocations: unknown) =>
    server("select public.set_slot_allocations($1, $2, $3::jsonb)", [
      actor,
      slot,
      JSON.stringify(allocations),
    ]);

  it("splits a slot 750/250", async () => {
    const { owner, slot1, ibrahim, osama } = await setup();
    await set(owner.id, slot1, [
      { member_id: ibrahim, amount: "750.00" },
      { member_id: osama, amount: "250.00" },
    ]);
    const rows = await server<{ amount: string }>(
      "select amount from public.slot_allocations where slot_id = $1 order by amount desc",
      [slot1],
    );
    expect(rows.map((r) => r.amount)).toEqual(["750.00", "250.00"]);
  });

  it("rejects totals that are not exactly the slot amount", async () => {
    const { owner, slot1, ibrahim, osama } = await setup();
    await expect(
      set(owner.id, slot1, [
        { member_id: ibrahim, amount: "500" },
        { member_id: osama, amount: "600" },
      ]),
    ).rejects.toThrow(/must equal the slot amount/);
    await expect(set(owner.id, slot1, [{ member_id: ibrahim, amount: "999.99" }])).rejects.toThrow(
      /must equal the slot amount/,
    );
  });

  it("rejects duplicates, zero amounts and members of another group", async () => {
    const { owner, slot1, ibrahim } = await setup();
    await expect(
      set(owner.id, slot1, [
        { member_id: ibrahim, amount: "500" },
        { member_id: ibrahim, amount: "500" },
      ]),
    ).rejects.toThrow(/appears twice/);
    await expect(set(owner.id, slot1, [{ member_id: ibrahim, amount: "0" }])).rejects.toThrow(
      /positive amount/,
    );

    const otherGroup = await createGroup(owner.id);
    const outsider = await addMember(owner.id, otherGroup, "غريب");
    await expect(set(owner.id, slot1, [{ member_id: outsider, amount: "1000" }])).rejects.toThrow(
      /different groups/,
    );
  });

  it("replaces the previous split and allows clearing it in draft", async () => {
    const { owner, slot1, ibrahim, osama } = await setup();
    await set(owner.id, slot1, [
      { member_id: ibrahim, amount: "750" },
      { member_id: osama, amount: "250" },
    ]);
    await set(owner.id, slot1, [{ member_id: osama, amount: "1000" }]);
    let rows = await server<{ member_id: string; amount: string }>(
      "select member_id, amount from public.slot_allocations where slot_id = $1",
      [slot1],
    );
    expect(rows).toEqual([{ member_id: osama, amount: "1000.00" }]);

    await set(owner.id, slot1, []);
    rows = await server("select 1 from public.slot_allocations where slot_id = $1", [slot1]);
    expect(rows).toHaveLength(0);
  });

  it("a member may own shares in several slots", async () => {
    const { owner, groupId, ibrahim } = await setup();
    const [s1, s2] = await slotIds(groupId);
    await set(owner.id, s1, [{ member_id: ibrahim, amount: "1000" }]);
    await set(owner.id, s2, [{ member_id: ibrahim, amount: "1000" }]);
    const rows = await server("select 1 from public.slot_allocations where member_id = $1", [ibrahim]);
    expect(rows).toHaveLength(2);
  });

  it("is denied for non-managers and locked after the group starts", async () => {
    const { owner, groupId, slot1, ibrahim } = await setup();
    const stranger = await createUser();
    await expect(set(stranger.id, slot1, [{ member_id: ibrahim, amount: "1000" }])).rejects.toThrow(
      /not allowed/,
    );

    await server("update public.groups set status = 'active' where id = $1", [groupId]);
    await expect(set(owner.id, slot1, [{ member_id: ibrahim, amount: "1000" }])).rejects.toThrow(
      /locked/,
    );
    // Direct writes are blocked too, not just the function.
    await expect(
      server("insert into public.slot_allocations (slot_id, member_id, amount) values ($1, $2, 1000)", [
        slot1,
        ibrahim,
      ]),
    ).rejects.toThrow(/locked/);
  });
});

describe("reorder_payouts", () => {
  it("applies a full permutation and audits it", async () => {
    const owner = await createUser();
    const groupId = await createGroup(owner.id, 4);
    const ids = await slotIds(groupId); // slot numbers 1..4
    const newOrder = [ids[2], ids[0], ids[3], ids[1]]; // 3,1,4,2

    await server("select public.reorder_payouts($1, $2, $3)", [owner.id, groupId, newOrder]);

    // The slots (and whoever owns them) moved; the names stay 1..N = the turn order.
    const rows = await server<{ id: string; slot_number: number; payout_order: number }>(
      "select id, slot_number, payout_order from public.group_slots where group_id = $1 order by payout_order",
      [groupId],
    );
    expect(rows.map((r) => r.id)).toEqual(newOrder);
    expect(rows.map((r) => [r.slot_number, r.payout_order])).toEqual([
      [1, 1],
      [2, 2],
      [3, 3],
      [4, 4],
    ]);

    const [log] = await server<{ metadata: { before: number[]; after: number[] } }>(
      "select metadata from public.activity_logs where group_id = $1 and action = 'group.payout_order_changed'",
      [groupId],
    );
    expect(log.metadata).toMatchObject({ before: [1, 2, 3, 4], after: [3, 1, 4, 2] });
  });

  it("moving the first name to 5th keeps names 1..N and moves the owners", async () => {
    const owner = await createUser();
    const groupId = await createGroup(owner.id, 6);
    const ids = await slotIds(groupId);
    const people = ["أ", "ب", "ج", "د", "ه", "و"];
    for (const [i, name] of people.entries()) {
      const m = await addMember(owner.id, groupId, name);
      await server("select public.set_slot_allocations($1, $2, $3::jsonb)", [
        owner.id,
        ids[i],
        JSON.stringify([{ member_id: m, amount: "1000" }]),
      ]);
    }
    // Move "اسم 1" (owner أ) to the 5th turn.
    const newOrder = [ids[1], ids[2], ids[3], ids[4], ids[0], ids[5]];
    await server("select public.reorder_payouts($1, $2, $3)", [owner.id, groupId, newOrder]);

    const rows = await server<{ slot_number: number; owner: string }>(
      `select s.slot_number, m.display_name as owner
         from public.group_slots s
         join public.slot_allocations a on a.slot_id = s.id
         join public.group_members m on m.id = a.member_id
        where s.group_id = $1 order by s.slot_number`,
      [groupId],
    );
    expect(rows).toEqual([
      { slot_number: 1, owner: "ب" },
      { slot_number: 2, owner: "ج" },
      { slot_number: 3, owner: "د" },
      { slot_number: 4, owner: "ه" },
      { slot_number: 5, owner: "أ" },
      { slot_number: 6, owner: "و" },
    ]);
  });

  it("rejects missing, duplicated or foreign slots, and non-managers", async () => {
    const owner = await createUser();
    const groupId = await createGroup(owner.id, 3);
    const otherGroup = await createGroup(owner.id, 3);
    const ids = await slotIds(groupId);
    const [foreign] = await slotIds(otherGroup);

    const reorder = (actor: string, order: string[]) =>
      server("select public.reorder_payouts($1, $2, $3)", [actor, groupId, order]);

    await expect(reorder(owner.id, [ids[0], ids[1]])).rejects.toThrow(/exactly once/);
    await expect(reorder(owner.id, [ids[0], ids[0], ids[1]])).rejects.toThrow(/exactly once/);
    await expect(reorder(owner.id, [ids[0], ids[1], foreign])).rejects.toThrow(/exactly once/);

    const stranger = await createUser();
    await expect(reorder(stranger.id, [ids[2], ids[1], ids[0]])).rejects.toThrow(/not allowed/);
  });
});
