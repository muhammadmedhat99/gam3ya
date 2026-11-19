import "server-only";
import { notFound } from "next/navigation";
import { todayInCairo } from "@/lib/dates";
import { multiplyAmount, splitPot, sumAmounts } from "@/lib/money";
import { db } from "@/lib/supabase/admin";
import { getGroupSlots, requireGroupAccess, type GroupContext } from "./group-detail";

/**
 * ADMIN-ONLY payout read model (owner/admin, not collectors, not members).
 * Before an admin records the first payout of a cycle, entitlements are a
 * preview computed with the same rule the database snapshots (splitPot).
 */

export type PayoutStatus = "pending" | "partially_paid" | "paid";

export async function requirePayoutManager(groupId: string): Promise<GroupContext> {
  const ctx = await requireGroupAccess(groupId);
  if (!ctx.group.isManager || ctx.group.status === "draft") notFound();
  return ctx;
}

export interface PayoutEntry {
  id: string;
  kind: "payment" | "reversal";
  amount: string;
  paidOn: string;
  method: "cash" | "transfer" | null;
  note: string | null;
  recordedBy: string;
  reversed: boolean;
}

export interface PayoutOwner {
  memberId: string;
  name: string;
  share: string;
  expected: string;
  received: string;
  remaining: string;
  status: PayoutStatus;
  entries: PayoutEntry[];
}

export interface CyclePayout {
  cycles: { id: string; number: number; startsOn: string; dueOn: string }[];
  cycle: { id: string; number: number; startsOn: string; dueOn: string };
  started: boolean;
  /** Snapshot exists (an admin already recorded something for this cycle). */
  recorded: boolean;
  slotNumber: number | null;
  pot: string;
  collected: string;
  owners: PayoutOwner[];
}

export async function getCyclePayout(ctx: GroupContext, cycleNumber?: number): Promise<CyclePayout> {
  const groupId = ctx.group.id;
  const { data: cycleRows, error } = await db()
    .from("group_cycles")
    .select("id, cycle_number, starts_on, due_on")
    .eq("group_id", groupId)
    .neq("status", "cancelled")
    .order("cycle_number")
    .returns<{ id: string; cycle_number: number; starts_on: string; due_on: string }[]>();
  if (error) throw new Error(`cycles: ${error.message}`);
  if (cycleRows.length === 0) notFound();
  const cycles = cycleRows.map((c) => ({ id: c.id, number: c.cycle_number, startsOn: c.starts_on, dueOn: c.due_on }));
  const cycle = cycles.find((c) => c.number === (cycleNumber ?? Math.max(1, ctx.group.currentCycle))) ?? cycles[0];
  const started = cycle.startsOn <= todayInCairo();

  const [payoutRes, collectedRes, slots] = await Promise.all([
    db()
      .from("payout_records")
      .select("id, expected_amount::text, group_slots!inner(slot_number)")
      .eq("cycle_id", cycle.id)
      .maybeSingle<{ id: string; expected_amount: string; group_slots: { slot_number: number } }>(),
    db()
      .from("obligation_balances")
      .select("paid_total::text")
      .eq("group_id", groupId)
      .eq("cycle_number", cycle.number)
      .returns<{ paid_total: string }[]>(),
    getGroupSlots(ctx),
  ]);
  if (payoutRes.error) throw new Error(`payout: ${payoutRes.error.message}`);
  if (collectedRes.error) throw new Error(`collected: ${collectedRes.error.message}`);
  const collected = sumAmounts(collectedRes.data.map((r) => r.paid_total));

  // Not recorded yet: preview from the current payout order and allocations.
  if (!payoutRes.data) {
    const slot = slots.find((s) => s.payoutOrder === cycle.number);
    const pot = multiplyAmount(ctx.group.slotAmount, slots.length);
    const shares = slot ? splitPot(pot, ctx.group.slotAmount, slot.owners.map((o) => o.amount)) : [];
    return {
      cycles,
      cycle,
      started,
      recorded: false,
      slotNumber: slot?.slotNumber ?? null,
      pot,
      collected,
      owners: (slot?.owners ?? []).map((o, i) => ({
        memberId: o.memberId,
        name: o.name,
        share: o.amount,
        expected: shares[i],
        received: "0.00",
        remaining: shares[i],
        status: "pending" as const,
        entries: [],
      })),
    };
  }

  const payout = payoutRes.data;
  const [balancesRes, membersRes] = await Promise.all([
    db()
      .from("payout_allocation_balances")
      .select("payout_allocation_id, member_id, share_amount::text, expected_amount::text, paid_total::text, outstanding::text, status")
      .eq("payout_id", payout.id)
      .returns<
        {
          payout_allocation_id: string;
          member_id: string;
          share_amount: string;
          expected_amount: string;
          paid_total: string;
          outstanding: string;
          status: PayoutStatus;
        }[]
      >(),
    db().from("group_members").select("id, display_name").eq("group_id", groupId),
  ]);
  if (balancesRes.error) throw new Error(`payout balances: ${balancesRes.error.message}`);
  if (membersRes.error) throw new Error(`members: ${membersRes.error.message}`);
  const names = new Map((membersRes.data as { id: string; display_name: string }[]).map((m) => [m.id, m.display_name]));

  const allocationIds = balancesRes.data.map((b) => b.payout_allocation_id);
  const { data: ledger, error: ledgerError } = await db()
    .from("payout_disbursements")
    .select(
      "id, payout_allocation_id, kind, amount::text, paid_on, method, note, reversal_of_id, created_at, users!payout_disbursements_recorded_by_user_id_fkey(full_name)",
    )
    .in("payout_allocation_id", allocationIds)
    .order("created_at", { ascending: false })
    .returns<
      {
        id: string;
        payout_allocation_id: string;
        kind: "payment" | "reversal";
        amount: string;
        paid_on: string;
        method: "cash" | "transfer" | null;
        note: string | null;
        reversal_of_id: string | null;
        users: { full_name: string };
      }[]
    >();
  if (ledgerError) throw new Error(`payout ledger: ${ledgerError.message}`);
  const reversed = new Set(ledger.filter((e) => e.reversal_of_id).map((e) => e.reversal_of_id as string));

  return {
    cycles,
    cycle,
    started,
    recorded: true,
    slotNumber: payout.group_slots.slot_number,
    pot: payout.expected_amount,
    collected,
    owners: balancesRes.data
      .sort((a, b) => Number(b.share_amount) - Number(a.share_amount))
      .map((b) => ({
        memberId: b.member_id,
        name: names.get(b.member_id) ?? "—",
        share: b.share_amount,
        expected: b.expected_amount,
        received: b.paid_total,
        remaining: b.outstanding,
        status: b.status,
        entries: ledger
          .filter((e) => e.payout_allocation_id === b.payout_allocation_id)
          .map((e) => ({
            id: e.id,
            kind: e.kind,
            amount: e.amount,
            paidOn: e.paid_on,
            method: e.method,
            note: e.note,
            recordedBy: e.users.full_name,
            reversed: reversed.has(e.id),
          })),
      })),
  };
}
