import "server-only";
import { todayInCairo } from "@/lib/dates";
import { buildSchedule, currentCycleNumber, type Frequency } from "@/lib/schedule";
import { db } from "@/lib/supabase/admin";

/**
 * Read model for "my associations". Authorization: only groups where the user
 * has a role or an ACTIVE, LINKED membership. Pending link requests grant nothing.
 * Never returns payment data (BUSINESS_RULES.md §9): that lives in admin-only services.
 */

export type GroupRole = "owner" | "admin" | "collector" | "member";
export type GroupStatus = "draft" | "active" | "completed" | "cancelled";

export interface MyShare {
  slotNumber: number;
  amount: string;
  coOwners: string[];
  payoutDate: string;
}

export interface GroupSummary {
  id: string;
  name: string;
  slotAmount: string;
  slotCount: number;
  frequency: Frequency;
  status: GroupStatus;
  role: GroupRole;
  isManager: boolean;
  /** Owner, admin or collector: may see and record collections (admin-only data). */
  canCollect: boolean;
  totalCycles: number;
  currentCycle: number;
  lastDueOn: string | null;
  /** The cycle running now (active groups): whose turn and when. */
  currentTurn: { slotNumber: number; owners: string[]; dueOn: string } | null;
  /** Due date of the next collection that hasn't passed yet. */
  nextDueOn: string | null;
  myShares: MyShare[];
  startDate: string;
  dueDay: number;
  ownerName: string;
}

interface GroupRow {
  id: string;
  name: string;
  slot_amount: string;
  frequency: Frequency;
  start_date: string;
  collection_due_day: number;
  status: GroupStatus;
  users: { full_name: string };
}

interface SlotRow {
  id: string;
  group_id: string;
  slot_number: number;
  payout_order: number;
}

interface AllocationRow {
  slot_id: string;
  member_id: string;
  amount: string;
  group_members: { display_name: string };
}

const STATUS_RANK: Record<GroupStatus, number> = { active: 0, draft: 1, completed: 2, cancelled: 3 };

function check<T>(res: { data: T | null; error: { message: string } | null }, what: string): T {
  if (res.error) throw new Error(`${what}: ${res.error.message}`);
  return res.data as T;
}

/**
 * All groups the user can open, or just one (`onlyGroupId`). Two round trips:
 * (roles ∥ memberships), then (groups ∥ slots ∥ allocations).
 */
export async function listMyGroups(userId: string, onlyGroupId?: string): Promise<GroupSummary[]> {
  let rolesQuery = db().from("group_roles").select("group_id, role").eq("user_id", userId);
  let membersQuery = db().from("group_members").select("id, group_id").eq("user_id", userId).eq("status", "active");
  if (onlyGroupId) {
    rolesQuery = rolesQuery.eq("group_id", onlyGroupId);
    membersQuery = membersQuery.eq("group_id", onlyGroupId);
  }
  const [roles, memberships] = await Promise.all([rolesQuery, membersQuery]);
  const roleRows = check(roles, "roles") as { group_id: string; role: GroupRole }[];
  const memberRows = check(memberships, "memberships") as { id: string; group_id: string }[];

  const groupIds = [...new Set([...roleRows.map((r) => r.group_id), ...memberRows.map((m) => m.group_id)])];
  if (groupIds.length === 0) return [];

  const [groupsRes, slotsRes, allocationsRes] = await Promise.all([
    db()
      .from("groups")
      .select(
        "id, name, slot_amount::text, frequency, start_date, collection_due_day, status, users!groups_owner_user_id_fkey(full_name)",
      )
      .in("id", groupIds)
      .returns<GroupRow[]>(),
    db()
      .from("group_slots")
      .select("id, group_id, slot_number, payout_order")
      .in("group_id", groupIds)
      .neq("status", "inactive"),
    db()
      .from("slot_allocations")
      .select("slot_id, member_id, amount::text, group_members!inner(display_name, group_id)")
      .in("group_members.group_id", groupIds)
      // many-to-one embed: PostgREST returns an object, not an array
      .returns<AllocationRow[]>(),
  ]);
  const groups = check(groupsRes, "groups") as GroupRow[];
  const slots = check(slotsRes, "slots") as SlotRow[];
  const activeSlotIds = new Set(slots.map((s) => s.id));
  const allocations = (check(allocationsRes, "allocations") as AllocationRow[]).filter((a) =>
    activeSlotIds.has(a.slot_id),
  );

  const myMemberIds = new Set(memberRows.map((m) => m.id));
  const roleByGroup = new Map(roleRows.map((r) => [r.group_id, r.role]));
  const today = todayInCairo();

  const summaries = groups.map((g): GroupSummary => {
    const groupSlots = slots.filter((s) => s.group_id === g.id);
    const schedule = buildSchedule({
      startDate: g.start_date,
      frequency: g.frequency,
      dueDay: g.collection_due_day,
      cycles: groupSlots.length,
    });
    const currentCycle = g.status === "active" ? currentCycleNumber(schedule, today) : 0;
    const ownersOf = (slotId: string) =>
      allocations.filter((a) => a.slot_id === slotId).map((a) => a.group_members.display_name);

    const turnSlot = groupSlots.find((s) => s.payout_order === currentCycle);
    const role = roleByGroup.get(g.id) ?? "member";

    const myShares = allocations
      .filter((a) => myMemberIds.has(a.member_id))
      .flatMap((a) => {
        const slot = groupSlots.find((s) => s.id === a.slot_id);
        if (!slot) return [];
        const coOwners = allocations
          .filter((o) => o.slot_id === slot.id && o.member_id !== a.member_id)
          .map((o) => o.group_members.display_name);
        return [
          {
            slotNumber: slot.slot_number,
            amount: a.amount,
            coOwners,
            payoutDate: schedule[slot.payout_order - 1]?.dueOn ?? "",
          },
        ];
      })
      .sort((x, y) => x.payoutDate.localeCompare(y.payoutDate));

    return {
      id: g.id,
      name: g.name,
      slotAmount: g.slot_amount,
      slotCount: groupSlots.length,
      frequency: g.frequency,
      status: g.status,
      role,
      isManager: role === "owner" || role === "admin",
      canCollect: role === "owner" || role === "admin" || role === "collector",
      totalCycles: schedule.length,
      currentCycle,
      lastDueOn: schedule.at(-1)?.dueOn ?? null,
      currentTurn:
        turnSlot && currentCycle > 0
          ? {
              slotNumber: turnSlot.slot_number,
              owners: ownersOf(turnSlot.id),
              dueOn: schedule[currentCycle - 1].dueOn,
            }
          : null,
      nextDueOn: g.status === "active" ? (schedule.find((c) => c.dueOn >= today)?.dueOn ?? null) : null,
      myShares,
      startDate: g.start_date,
      dueDay: g.collection_due_day,
      ownerName: g.users.full_name,
    };
  });

  return summaries.sort(
    (a, b) => STATUS_RANK[a.status] - STATUS_RANK[b.status] || a.name.localeCompare(b.name, "ar"),
  );
}

/** How many associations are waiting for an admin to approve this user. No details (§10). */
export async function countMyPendingLinkRequests(userId: string): Promise<number> {
  const { count, error } = await db()
    .from("member_link_requests")
    .select("id", { count: "exact", head: true })
    .eq("user_id", userId)
    .eq("status", "pending");
  if (error) throw new Error(`pending requests: ${error.message}`);
  return count ?? 0;
}

export interface AdminTask {
  groupId: string;
  groupName: string;
  pendingLinkRequests: number;
  /** Members overdue in the running cycle (admin/collector only). */
  overdue: number;
  currentCycle: number;
  dueOn: string | null;
}

/** "محتاج تعمله" on the home screen: only for groups the user manages or collects for. */
export async function adminTasks(groups: GroupSummary[]): Promise<AdminTask[]> {
  const managed = groups.filter((g) => g.canCollect && (g.status === "draft" || g.status === "active"));
  if (managed.length === 0) return [];

  const managerIds = managed.filter((g) => g.isManager).map((g) => g.id);
  const [requestsRes, overdueRes] = await Promise.all([
    managerIds.length
      ? db().from("member_link_requests").select("group_id").eq("status", "pending").in("group_id", managerIds)
      : Promise.resolve({ data: [], error: null }),
    db()
      .from("obligation_balances")
      .select("group_id, cycle_number, due_on")
      .eq("status", "overdue")
      .in("group_id", managed.map((g) => g.id)),
  ]);
  const requests = check(requestsRes, "admin tasks") as { group_id: string }[];
  const overdue = check(overdueRes, "overdue") as { group_id: string; cycle_number: number; due_on: string }[];

  return managed
    .map((g) => {
      const late = overdue.filter((r) => r.group_id === g.id && r.cycle_number === g.currentCycle);
      return {
        groupId: g.id,
        groupName: g.name,
        pendingLinkRequests: requests.filter((r) => r.group_id === g.id).length,
        overdue: late.length,
        currentCycle: g.currentCycle,
        dueOn: late[0]?.due_on ?? null,
      };
    })
    .filter((t) => t.pendingLinkRequests > 0 || t.overdue > 0);
}

/**
 * One group, only if the user has a role in it or an active linked membership.
 * (The super admin reaches other groups through the super-admin panel, not here.)
 */
export async function getGroupForUser(groupId: string, userId: string): Promise<GroupSummary | null> {
  if (!/^[0-9a-f-]{36}$/i.test(groupId)) return null;
  return (await listMyGroups(userId, groupId))[0] ?? null;
}
