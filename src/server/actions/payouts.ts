"use server";

import { revalidatePath } from "next/cache";
import { db } from "@/lib/supabase/admin";
import {
  recordPayoutSchema,
  reversePayoutSchema,
  type RecordPayoutInput,
  type ReversePayoutInput,
} from "@/lib/validation/payouts";
import { requireUser } from "@/server/auth/dal";
import { fromZodError, type ActionError } from "./result";

/**
 * Payout mutations (owner/admin only). ensure_payout snapshots the cycle's
 * payout the first time; record/reverse write the append-only ledger. Each DB
 * function re-checks the actor and the business rules in one transaction.
 */

type Result = { ok: true } | ActionError;

function refresh(groupId: string) {
  revalidatePath(`/groups/${groupId}`, "layout");
  revalidatePath("/");
}

export async function recordPayoutAction(input: RecordPayoutInput): Promise<Result> {
  const user = await requireUser();
  const parsed = recordPayoutSchema.safeParse(input);
  if (!parsed.success) return fromZodError(parsed.error);
  const v = parsed.data;

  const { data: cycle } = await db()
    .from("group_cycles")
    .select("group_id")
    .eq("id", v.cycleId)
    .maybeSingle<{ group_id: string }>();
  if (!cycle || cycle.group_id !== v.groupId) return { error: "الدورة دي مش موجودة." };

  const { data: payoutId, error: ensureError } = await db().rpc("ensure_payout", {
    p_actor_user_id: user.id,
    p_cycle_id: v.cycleId,
  });
  if (ensureError) {
    if (ensureError.code === "42501") return { error: "تسجيل القبض للأدمن بس." };
    if (ensureError.message.includes("not started")) return { error: "الدورة دي لسه مبدأتش." };
    return { error: "حصلت مشكلة. جرب تاني." };
  }

  const { data: allocation } = await db()
    .from("payout_allocations")
    .select("id")
    .eq("payout_id", payoutId as string)
    .eq("member_id", v.memberId)
    .maybeSingle<{ id: string }>();
  if (!allocation) return { error: "الشخص ده مش من أصحاب الاسم اللي عليه الدور." };

  const { error } = await db().rpc("record_payout_disbursement", {
    p_actor_user_id: user.id,
    p_payout_allocation_id: allocation.id,
    p_amount: v.amount,
    p_paid_on: v.paidOn,
    p_method: v.method,
    p_note: v.note ?? null,
    p_idempotency_key: v.idempotencyKey,
  });
  if (error) {
    if (error.code === "42501") return { error: "تسجيل القبض للأدمن بس." };
    if (error.message.includes("exceeds")) return { fieldErrors: { amount: "المبلغ أكبر من الباقي له" } };
    if (error.message.includes("future")) return { fieldErrors: { paidOn: "التاريخ ماينفعش يبقى بعد النهارده" } };
    return { error: "حصلت مشكلة. جرب تاني." };
  }

  refresh(v.groupId);
  return { ok: true };
}

export async function reversePayoutAction(input: ReversePayoutInput): Promise<Result> {
  const user = await requireUser();
  const parsed = reversePayoutSchema.safeParse(input);
  if (!parsed.success) return fromZodError(parsed.error);
  const v = parsed.data;

  const { data: row } = await db()
    .from("payout_disbursements")
    .select("payout_allocations!inner(payout_records!inner(group_id))")
    .eq("id", v.disbursementId)
    .maybeSingle<{ payout_allocations: { payout_records: { group_id: string } } }>();
  if (!row || row.payout_allocations.payout_records.group_id !== v.groupId) {
    return { error: "مش لاقيين التسجيل ده." };
  }

  const { error } = await db().rpc("reverse_payout_disbursement", {
    p_actor_user_id: user.id,
    p_disbursement_id: v.disbursementId,
    p_reason: v.reason,
  });
  if (error) {
    if (error.code === "42501") return { error: "التصحيح للأدمن بس." };
    if (error.message.includes("already reversed")) return { error: "التسجيل ده اتصحح قبل كده." };
    return { error: "حصلت مشكلة. جرب تاني." };
  }

  refresh(v.groupId);
  return { ok: true };
}
