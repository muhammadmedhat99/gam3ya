import "server-only";
import { notFound } from "next/navigation";
import { formatAmount, sumAmounts } from "@/lib/money";
import { db } from "@/lib/supabase/admin";
import { requireGroupAccess, type GroupContext } from "./group-detail";

/**
 * ADMIN-ONLY financial read model (BUSINESS_RULES.md §7, §9).
 * Every function here requires the caller to be owner/admin/collector of the
 * group; members get a 404 and never receive payment status, amounts paid,
 * balances, overdue flags, dates or history, not even their own.
 */

export type PaymentStatus = "paid" | "partially_paid" | "unpaid" | "overdue";

export async function requireCollector(groupId: string): Promise<GroupContext> {
  const ctx = await requireGroupAccess(groupId);
  if (!ctx.group.canCollect || ctx.group.status === "draft") notFound();
  return ctx;
}

interface BalanceRow {
  obligation_id: string;
  member_id: string;
  cycle_number: number;
  amount_due: string;
  paid_total: string;
  outstanding: string;
  due_on: string;
  status: PaymentStatus;
}

const BALANCE_COLUMNS =
  "obligation_id, member_id, cycle_number, amount_due::text, paid_total::text, outstanding::text, due_on, status";

/** "اسم 6: 500 + اسم 9: 1,000" per member, from the group's allocations. */
async function slotBreakdown(groupId: string): Promise<Map<string, { slotNumber: number; amount: string }[]>> {
  const { data, error } = await db()
    .from("group_slots")
    .select("slot_number, slot_allocations(member_id, amount::text)")
    .eq("group_id", groupId)
    .neq("status", "inactive")
    .order("slot_number")
    .returns<{ slot_number: number; slot_allocations: { member_id: string; amount: string }[] }[]>();
  if (error) throw new Error(`slot breakdown: ${error.message}`);
  const map = new Map<string, { slotNumber: number; amount: string }[]>();
  for (const slot of data) {
    for (const a of slot.slot_allocations) {
      map.set(a.member_id, [...(map.get(a.member_id) ?? []), { slotNumber: slot.slot_number, amount: a.amount }]);
    }
  }
  return map;
}

export function breakdownText(parts: { slotNumber: number; amount: string }[]): string {
  if (parts.length === 1) return `اسم ${parts[0].slotNumber}`;
  return parts.map((p) => `اسم ${p.slotNumber}: ${formatAmount(p.amount)}`).join(" + ");
}

export interface CycleOption {
  number: number;
  dueOn: string;
  startsOn: string;
}

export interface CollectionRow {
  obligationId: string;
  memberId: string;
  name: string;
  breakdown: string;
  due: string;
  paid: string;
  outstanding: string;
  status: PaymentStatus;
}

export interface CycleCollection {
  cycles: CycleOption[];
  cycle: CycleOption;
  rows: CollectionRow[];
  expected: string;
  collected: string;
  counts: Record<PaymentStatus, number>;
}

/** One cycle's collection sheet. `cycleNumber` defaults to the running cycle. */
export async function getCycleCollection(ctx: GroupContext, cycleNumber?: number): Promise<CycleCollection> {
  const groupId = ctx.group.id;
  const { data: cycleRows, error: cyclesError } = await db()
    .from("group_cycles")
    .select("cycle_number, starts_on, due_on")
    .eq("group_id", groupId)
    .neq("status", "cancelled")
    .order("cycle_number")
    .returns<{ cycle_number: number; starts_on: string; due_on: string }[]>();
  if (cyclesError) throw new Error(`cycles: ${cyclesError.message}`);
  const cycles = cycleRows.map((c) => ({ number: c.cycle_number, dueOn: c.due_on, startsOn: c.starts_on }));
  if (cycles.length === 0) notFound();

  const wanted = cycleNumber ?? Math.max(1, ctx.group.currentCycle);
  const cycle = cycles.find((c) => c.number === wanted) ?? cycles[0];

  const [balancesRes, membersRes, breakdown] = await Promise.all([
    db()
      .from("obligation_balances")
      .select(BALANCE_COLUMNS)
      .eq("group_id", groupId)
      .eq("cycle_number", cycle.number)
      .neq("status", "cancelled")
      .returns<BalanceRow[]>(),
    db().from("group_members").select("id, display_name").eq("group_id", groupId),
    slotBreakdown(groupId),
  ]);
  if (balancesRes.error) throw new Error(`balances: ${balancesRes.error.message}`);
  if (membersRes.error) throw new Error(`members: ${membersRes.error.message}`);

  const names = new Map((membersRes.data as { id: string; display_name: string }[]).map((m) => [m.id, m.display_name]));
  const order: Record<PaymentStatus, number> = { overdue: 0, partially_paid: 1, unpaid: 2, paid: 3 };

  const rows = balancesRes.data
    .map((b) => ({
      obligationId: b.obligation_id,
      memberId: b.member_id,
      name: names.get(b.member_id) ?? "—",
      breakdown: breakdownText(breakdown.get(b.member_id) ?? []),
      due: b.amount_due,
      paid: b.paid_total,
      outstanding: b.outstanding,
      status: b.status,
    }))
    .sort((a, b) => order[a.status] - order[b.status] || a.name.localeCompare(b.name, "ar"));

  const counts: Record<PaymentStatus, number> = { paid: 0, partially_paid: 0, unpaid: 0, overdue: 0 };
  for (const r of rows) counts[r.status] += 1;

  return {
    cycles,
    cycle,
    rows,
    expected: sumAmounts(rows.map((r) => r.due)),
    collected: sumAmounts(rows.map((r) => r.paid)),
    counts,
  };
}

// --------------------------------------------------------------------------- member history

export interface LedgerEntry {
  id: string;
  kind: "payment" | "reversal";
  amount: string;
  paidOn: string;
  method: "cash" | "transfer" | null;
  note: string | null;
  recordedBy: string;
  /** For a reversal: the date of the payment it cancels. */
  reversesPaidOn: string | null;
  /** For a payment: whether a reversal cancels it. */
  reversed: boolean;
}

export interface MemberCycleHistory {
  obligationId: string;
  cycleNumber: number;
  dueOn: string;
  due: string;
  paid: string;
  outstanding: string;
  status: PaymentStatus;
  entries: LedgerEntry[];
}

export interface MemberPayments {
  memberId: string;
  name: string;
  phone: string | null;
  breakdown: { slotNumber: number; amount: string }[];
  perCycle: string;
  cycles: MemberCycleHistory[];
}

export async function getMemberPayments(ctx: GroupContext, memberId: string): Promise<MemberPayments> {
  if (!/^[0-9a-f-]{36}$/i.test(memberId)) notFound();
  const groupId = ctx.group.id;

  const { data: member } = await db()
    .from("group_members")
    .select("id, display_name, phone_e164")
    .eq("id", memberId)
    .eq("group_id", groupId)
    .maybeSingle<{ id: string; display_name: string; phone_e164: string | null }>();
  if (!member) notFound();

  const [balancesRes, breakdown] = await Promise.all([
    db()
      .from("obligation_balances")
      .select(BALANCE_COLUMNS)
      .eq("group_id", groupId)
      .eq("member_id", memberId)
      .neq("status", "cancelled")
      .order("cycle_number", { ascending: false })
      .returns<BalanceRow[]>(),
    slotBreakdown(groupId),
  ]);
  if (balancesRes.error) throw new Error(`balances: ${balancesRes.error.message}`);
  const balances = balancesRes.data;

  const { data: ledger, error: ledgerError } = balances.length
    ? await db()
        .from("payment_records")
        .select(
          "id, obligation_id, kind, amount::text, paid_on, method, note, reversal_of_id, created_at, users!payment_records_recorded_by_user_id_fkey(full_name)",
        )
        .in("obligation_id", balances.map((b) => b.obligation_id))
        .order("created_at", { ascending: false })
        .returns<
          {
            id: string;
            obligation_id: string;
            kind: "payment" | "reversal";
            amount: string;
            paid_on: string;
            method: "cash" | "transfer" | null;
            note: string | null;
            reversal_of_id: string | null;
            created_at: string;
            users: { full_name: string };
          }[]
        >()
    : { data: [], error: null };
  if (ledgerError) throw new Error(`ledger: ${ledgerError.message}`);

  const byId = new Map(ledger.map((e) => [e.id, e]));
  const reversedIds = new Set(ledger.filter((e) => e.reversal_of_id).map((e) => e.reversal_of_id as string));
  const parts = breakdown.get(memberId) ?? [];

  return {
    memberId,
    name: member.display_name,
    phone: member.phone_e164,
    breakdown: parts,
    perCycle: sumAmounts(parts.map((p) => p.amount)),
    cycles: balances.map((b) => ({
      obligationId: b.obligation_id,
      cycleNumber: b.cycle_number,
      dueOn: b.due_on,
      due: b.amount_due,
      paid: b.paid_total,
      outstanding: b.outstanding,
      status: b.status,
      entries: ledger
        .filter((e) => e.obligation_id === b.obligation_id)
        .map((e) => ({
          id: e.id,
          kind: e.kind,
          amount: e.amount,
          paidOn: e.paid_on,
          method: e.method,
          note: e.note,
          recordedBy: e.users.full_name,
          reversesPaidOn: e.reversal_of_id ? (byId.get(e.reversal_of_id)?.paid_on ?? null) : null,
          reversed: reversedIds.has(e.id),
        })),
    })),
  };
}

/** Overview card + home "محتاج تعمله": the running cycle's totals for one group. */
export async function currentCycleTotals(
  groupId: string,
  cycleNumber: number,
): Promise<{ expected: string; collected: string; counts: Record<PaymentStatus, number>; dueOn: string } | null> {
  if (cycleNumber < 1) return null;
  const { data, error } = await db()
    .from("obligation_balances")
    .select("amount_due::text, paid_total::text, status, due_on")
    .eq("group_id", groupId)
    .eq("cycle_number", cycleNumber)
    .neq("status", "cancelled")
    .returns<{ amount_due: string; paid_total: string; status: PaymentStatus; due_on: string }[]>();
  if (error) throw new Error(`cycle totals: ${error.message}`);
  if (data.length === 0) return null;
  const counts: Record<PaymentStatus, number> = { paid: 0, partially_paid: 0, unpaid: 0, overdue: 0 };
  for (const r of data) counts[r.status] += 1;
  return {
    expected: sumAmounts(data.map((r) => r.amount_due)),
    collected: sumAmounts(data.map((r) => r.paid_total)),
    counts,
    dueOn: data[0].due_on,
  };
}
