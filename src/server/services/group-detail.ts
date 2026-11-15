import "server-only";
import { notFound } from "next/navigation";
import { cache } from "react";
import { buildSchedule } from "@/lib/schedule";
import { fromPiasters, sumAmounts, toPiasters } from "@/lib/money";
import { db } from "@/lib/supabase/admin";
import { requireUser, type CurrentUser } from "@/server/auth/dal";
import { getGroupForUser, type GroupSummary } from "./groups";

/**
 * Read model for one association's pages. Access = role in the group or an
 * active linked membership (getGroupForUser). Managers get phones, registration
 * state and link requests; members get names, shares and the payout order only.
 * No payment data here (BUSINESS_RULES.md §9).
 */

export interface GroupContext {
  user: CurrentUser;
  group: GroupSummary;
  startDate: string;
  dueDay: number;
  ownerName: string;
}

/** Use at the top of every /groups/[groupId] page and layout (memoized per request). */
export const requireGroupAccess = cache(async (groupId: string): Promise<GroupContext> => {
  const user = await requireUser();
  const group = await getGroupForUser(groupId, user.id);
  if (!group) notFound();

  const { data, error } = await db()
    .from("groups")
    .select("start_date, collection_due_day, users!groups_owner_user_id_fkey(full_name)")
    .eq("id", groupId)
    .single<{ start_date: string; collection_due_day: number; users: { full_name: string } }>();
  if (error) throw new Error(`group context: ${error.message}`);

  return {
    user,
    group,
    startDate: data.start_date,
    dueDay: data.collection_due_day,
    ownerName: data.users.full_name,
  };
});

export async function requireGroupManager(groupId: string): Promise<GroupContext> {
  const ctx = await requireGroupAccess(groupId);
  if (!ctx.group.isManager) notFound();
  return ctx;
}

// --------------------------------------------------------------------------- members

export type RegistrationState = "linked" | "pending" | "unregistered";

export interface MemberRow {
  id: string;
  displayName: string;
  /** Managers only. */
  phone: string | null;
  /** Managers only. */
  registration: RegistrationState | null;
  slotNumbers: number[];
  isMe: boolean;
}

export async function getGroupMembers(ctx: GroupContext): Promise<MemberRow[]> {
  const groupId = ctx.group.id;
  const [membersRes, slotsRes, pendingRes] = await Promise.all([
    db()
      .from("group_members")
      .select("id, display_name, phone_e164, user_id")
      .eq("group_id", groupId)
      .eq("status", "active")
      .order("display_name"),
    db()
      .from("group_slots")
      .select("slot_number, slot_allocations(member_id)")
      .eq("group_id", groupId)
      .neq("status", "inactive")
      .returns<{ slot_number: number; slot_allocations: { member_id: string }[] }[]>(),
    ctx.group.isManager
      ? db().from("member_link_requests").select("member_id").eq("group_id", groupId).eq("status", "pending")
      : Promise.resolve({ data: [] as { member_id: string }[], error: null }),
  ]);
  if (membersRes.error) throw new Error(`members: ${membersRes.error.message}`);
  if (slotsRes.error) throw new Error(`member slots: ${slotsRes.error.message}`);
  if (pendingRes.error) throw new Error(`pending: ${pendingRes.error.message}`);

  const pending = new Set((pendingRes.data ?? []).map((r) => r.member_id));
  const manager = ctx.group.isManager;

  return (membersRes.data as { id: string; display_name: string; phone_e164: string | null; user_id: string | null }[]).map(
    (m) => ({
      id: m.id,
      displayName: m.display_name,
      phone: manager ? m.phone_e164 : null,
      registration: manager
        ? m.user_id
          ? "linked"
          : pending.has(m.id)
            ? "pending"
            : "unregistered"
        : null,
      slotNumbers: (slotsRes.data ?? [])
        .filter((s) => s.slot_allocations.some((a) => a.member_id === m.id))
        .map((s) => s.slot_number)
        .sort((a, b) => a - b),
      isMe: m.user_id === ctx.user.id,
    }),
  );
}

// --------------------------------------------------------------------------- slots

export type SlotFill = "full" | "short" | "over";

export interface SlotOwner {
  memberId: string;
  name: string;
  amount: string;
  isMe: boolean;
}

export interface SlotRow {
  id: string;
  slotNumber: number;
  payoutOrder: number;
  payoutDate: string;
  owners: SlotOwner[];
  allocated: string;
  /** slot amount − allocated (negative when over). */
  remaining: string;
  fill: SlotFill;
}

export async function getGroupSlots(ctx: GroupContext): Promise<SlotRow[]> {
  const { data, error } = await db()
    .from("group_slots")
    .select(
      "id, slot_number, payout_order, slot_allocations(member_id, amount::text, created_at, group_members!inner(display_name, user_id))",
    )
    .eq("group_id", ctx.group.id)
    .neq("status", "inactive")
    .order("payout_order")
    .returns<
      {
        id: string;
        slot_number: number;
        payout_order: number;
        slot_allocations: {
          member_id: string;
          amount: string;
          created_at: string;
          group_members: { display_name: string; user_id: string | null };
        }[];
      }[]
    >();
  if (error) throw new Error(`slots: ${error.message}`);

  const schedule = buildSchedule({
    startDate: ctx.startDate,
    frequency: ctx.group.frequency,
    dueDay: ctx.dueDay,
    cycles: data.length,
  });

  return data.map((s) => {
    // Same order the database uses for splitting a pot: earliest first, then member id
    // (so splitPot's "largest, first listed" picks the same owner for leftover piasters).
    const owners = [...s.slot_allocations]
      .sort((a, b) =>
        a.created_at === b.created_at
          ? a.member_id < b.member_id
            ? -1
            : 1
          : a.created_at.localeCompare(b.created_at),
      )
      .map((a) => ({
        memberId: a.member_id,
        name: a.group_members.display_name,
        amount: a.amount,
        isMe: a.group_members.user_id === ctx.user.id,
      }));
    const allocated = sumAmounts(owners.map((o) => o.amount));
    const diff = toPiasters(ctx.group.slotAmount) - toPiasters(allocated);
    const remaining = fromPiasters(diff);
    return {
      id: s.id,
      slotNumber: s.slot_number,
      payoutOrder: s.payout_order,
      payoutDate: schedule[s.payout_order - 1]?.dueOn ?? "",
      owners,
      allocated,
      remaining,
      fill: diff === 0n ? "full" : diff > 0n ? "short" : "over",
    };
  });
}

// --------------------------------------------------------------------------- link requests

export interface LinkRequestRow {
  id: string;
  createdAt: string;
  registeredName: string;
  phone: string;
  memberName: string;
}

export async function getPendingLinkRequests(ctx: GroupContext): Promise<LinkRequestRow[]> {
  if (!ctx.group.isManager) return [];
  const { data, error } = await db()
    .from("member_link_requests")
    .select(
      "id, created_at, users!member_link_requests_user_id_fkey(full_name, phone_e164), group_members!inner(display_name)",
    )
    .eq("group_id", ctx.group.id)
    .eq("status", "pending")
    .order("created_at", { ascending: false })
    .returns<
      {
        id: string;
        created_at: string;
        users: { full_name: string; phone_e164: string };
        group_members: { display_name: string };
      }[]
    >();
  if (error) throw new Error(`link requests: ${error.message}`);

  return data.map((r) => ({
    id: r.id,
    createdAt: r.created_at,
    registeredName: r.users.full_name,
    phone: r.users.phone_e164,
    memberName: r.group_members.display_name,
  }));
}

export async function countPendingLinkRequests(ctx: GroupContext): Promise<number> {
  if (!ctx.group.isManager) return 0;
  const { count, error } = await db()
    .from("member_link_requests")
    .select("id", { count: "exact", head: true })
    .eq("group_id", ctx.group.id)
    .eq("status", "pending");
  if (error) throw new Error(`link request count: ${error.message}`);
  return count ?? 0;
}
