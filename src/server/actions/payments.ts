"use server";

import { revalidatePath } from "next/cache";
import { db } from "@/lib/supabase/admin";
import {
  recordPaymentSchema,
  reversePaymentSchema,
  type RecordPaymentInput,
  type ReversePaymentInput,
} from "@/lib/validation/payments";
import { requireUser } from "@/server/auth/dal";
import { fromZodError, type ActionError } from "./result";

/**
 * Admin-only payment mutations. The database functions re-check that the actor
 * may collect (record) or manage (reverse) this group, lock the obligation,
 * enforce "no more than outstanding", and audit, all in one transaction.
 */

type Result = { ok: true } | ActionError;

/** Confirms the obligation belongs to the group in the URL (defense in depth). */
async function obligationInGroup(obligationId: string, groupId: string): Promise<boolean> {
  const { data } = await db()
    .from("obligation_balances")
    .select("group_id")
    .eq("obligation_id", obligationId)
    .maybeSingle<{ group_id: string }>();
  return data?.group_id === groupId;
}

function refresh(groupId: string) {
  revalidatePath(`/groups/${groupId}`, "layout");
  revalidatePath("/");
}

export async function recordPaymentAction(input: RecordPaymentInput): Promise<Result> {
  const user = await requireUser();
  const parsed = recordPaymentSchema.safeParse(input);
  if (!parsed.success) return fromZodError(parsed.error);
  const v = parsed.data;

  if (!(await obligationInGroup(v.obligationId, v.groupId))) return { error: "مش لاقيين المستحق ده." };

  const { error } = await db().rpc("record_payment", {
    p_actor_user_id: user.id,
    p_obligation_id: v.obligationId,
    p_amount: v.amount,
    p_paid_on: v.paidOn,
    p_method: v.method,
    p_note: v.note ?? null,
    p_idempotency_key: v.idempotencyKey,
  });
  if (error) {
    if (error.code === "42501") return { error: "مش مسموحلك تسجّل دفعات في الجمعية دي." };
    if (error.message.includes("exceeds outstanding")) {
      return { fieldErrors: { amount: "المبلغ أكبر من الباقي عليه" } };
    }
    if (error.message.includes("future")) return { fieldErrors: { paidOn: "التاريخ ماينفعش يبقى بعد النهارده" } };
    if (error.message.includes("not active")) return { error: "الجمعية مش شغالة." };
    return { error: "حصلت مشكلة. جرب تاني." };
  }

  refresh(v.groupId);
  return { ok: true };
}

export async function reversePaymentAction(input: ReversePaymentInput): Promise<Result> {
  const user = await requireUser();
  const parsed = reversePaymentSchema.safeParse(input);
  if (!parsed.success) return fromZodError(parsed.error);
  const v = parsed.data;

  const { data: payment } = await db()
    .from("payment_records")
    .select("obligation_id")
    .eq("id", v.paymentId)
    .maybeSingle<{ obligation_id: string }>();
  if (!payment || !(await obligationInGroup(payment.obligation_id, v.groupId))) {
    return { error: "مش لاقيين الدفعة دي." };
  }

  const { error } = await db().rpc("reverse_payment", {
    p_actor_user_id: user.id,
    p_payment_id: v.paymentId,
    p_reason: v.reason,
  });
  if (error) {
    if (error.code === "42501") return { error: "التصحيح للأدمن بس." };
    if (error.message.includes("already reversed")) return { error: "الدفعة دي اتصححت قبل كده." };
    return { error: "حصلت مشكلة. جرب تاني." };
  }

  refresh(v.groupId);
  return { ok: true };
}
