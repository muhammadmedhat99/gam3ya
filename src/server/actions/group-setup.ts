"use server";

import { revalidatePath } from "next/cache";
import { db } from "@/lib/supabase/admin";
import {
  addMemberSchema,
  reorderSchema,
  reviewLinkRequestSchema,
  setAllocationsSchema,
  type AddMemberInput,
  type ReorderInput,
  type ReviewLinkRequestInput,
  type SetAllocationsInput,
} from "@/lib/validation/group-setup";
import { requireUser } from "@/server/auth/dal";
import { fromZodError, type ActionError } from "./result";

/**
 * Association setup mutations. Each one goes through a database function that
 * re-checks the actor is the group's owner/admin (or the super admin), validates
 * the business rules, and writes the activity log in the same transaction.
 */

export type ActionOk = { ok: true };
type Result = ActionOk | ActionError;

interface DbError {
  code?: string;
  message: string;
}

function dbErrorMessage(error: DbError): ActionError {
  if (error.code === "42501") return { error: "مش مسموحلك تعمل ده في الجمعية دي." };
  if (error.code === "55000") return { error: "الحاجة دي اتقفلت بعد ما الجمعية بدأت." };
  if (error.message.includes("must equal the slot amount")) {
    return { error: "مجموع الحصص لازم يساوي قيمة الاسم بالظبط." };
  }
  if (error.message.includes("exactly once")) return { error: "الترتيب لازم يشمل كل اسم مرة واحدة." };
  if (error.message.includes("turns are locked")) {
    return { error: "الأدوار اللي فاتت والدورة الحالية متقفلة، ومينفعش تتحرك." };
  }
  if (error.message.includes("already reviewed")) return { error: "الطلب ده اتراجع قبل كده." };
  if (error.message.includes("already a member") || error.message.includes("already linked")) {
    return { error: "الحساب ده مربوط بعضو تاني في الجمعية دي." };
  }
  return { error: "حصلت مشكلة. جرب تاني." };
}

function refresh(groupId: string) {
  revalidatePath(`/groups/${groupId}`, "layout");
  revalidatePath("/");
}

export type AddMemberResult = Result | { needsConfirmation: { registeredName: string } };

export async function addMemberAction(input: AddMemberInput): Promise<AddMemberResult> {
  const user = await requireUser();
  const parsed = addMemberSchema.safeParse(input);
  if (!parsed.success) return fromZodError(parsed.error);
  const { groupId, displayName, phone, confirmLink } = parsed.data;

  // Check first, so non-managers can't use this to learn which phones have accounts.
  const { data: allowed, error: authError } = await db().rpc("is_group_manager", {
    p_group_id: groupId,
    p_user_id: user.id,
  });
  if (authError) throw new Error(`is_group_manager: ${authError.message}`);
  if (!allowed) return { error: "مش مسموحلك تعمل ده في الجمعية دي." };

  // Design "ضيف عضو: الرقم عليه حساب": show the registered name before linking.
  if (!confirmLink) {
    const { data: existing, error } = await db()
      .from("users")
      .select("full_name")
      .eq("phone_e164", phone)
      .maybeSingle<{ full_name: string }>();
    if (error) throw new Error(`phone lookup: ${error.message}`);
    if (existing) return { needsConfirmation: { registeredName: existing.full_name } };
  }

  const { error } = await db().rpc("add_group_member", {
    p_actor_user_id: user.id,
    p_group_id: groupId,
    p_display_name: displayName,
    p_phone_e164: phone,
    p_confirm_link: confirmLink,
  });
  if (error) {
    if (error.code === "23505") {
      return { fieldErrors: { phone: "الرقم ده مضاف في الجمعية دي بالفعل" } };
    }
    return dbErrorMessage(error);
  }

  refresh(groupId);
  return { ok: true };
}

export async function reviewLinkRequestAction(input: ReviewLinkRequestInput): Promise<Result> {
  const user = await requireUser();
  const parsed = reviewLinkRequestSchema.safeParse(input);
  if (!parsed.success) return fromZodError(parsed.error);
  const { groupId, requestId, approve } = parsed.data;

  // The function checks the request belongs to a group this user manages.
  const { data: req } = await db()
    .from("member_link_requests")
    .select("group_id")
    .eq("id", requestId)
    .maybeSingle<{ group_id: string }>();
  if (!req || req.group_id !== groupId) return { error: "الطلب ده مش موجود." };

  const { error } = await db().rpc("review_link_request", {
    p_actor_user_id: user.id,
    p_request_id: requestId,
    p_approve: approve,
  });
  if (error) return dbErrorMessage(error);

  refresh(groupId);
  return { ok: true };
}

export async function setSlotAllocationsAction(input: SetAllocationsInput): Promise<Result> {
  const user = await requireUser();
  const parsed = setAllocationsSchema.safeParse(input);
  if (!parsed.success) return fromZodError(parsed.error);
  const { groupId, slotId, allocations } = parsed.data;

  const { data: slot } = await db()
    .from("group_slots")
    .select("group_id")
    .eq("id", slotId)
    .maybeSingle<{ group_id: string }>();
  if (!slot || slot.group_id !== groupId) return { error: "الاسم ده مش موجود." };

  const { error } = await db().rpc("set_slot_allocations", {
    p_actor_user_id: user.id,
    p_slot_id: slotId,
    p_allocations: allocations.map((a) => ({ member_id: a.memberId, amount: a.amount })),
  });
  if (error) return dbErrorMessage(error);

  refresh(groupId);
  return { ok: true };
}

export async function activateGroupAction(input: { groupId: string }): Promise<Result> {
  const user = await requireUser();
  const parsed = reorderSchema.shape.groupId.safeParse(input.groupId);
  if (!parsed.success) return { error: "الجمعية دي مش موجودة." };

  // Checks manager, draft status and that every slot is fully allocated, then
  // creates the cycles and the dues snapshot atomically.
  const { error } = await db().rpc("activate_group", {
    p_actor_user_id: user.id,
    p_group_id: parsed.data,
  });
  if (error) {
    if (error.message.includes("fully allocated")) {
      return { error: "لازم كل الأسامي تبقى متقسمة كاملة الأول." };
    }
    if (error.message.includes("already started")) return { error: "الجمعية بدأت بالفعل." };
    if (error.message.includes("inactive member")) {
      return { error: "في حصة باسم عضو مش نشط. راجع تقسيم الأسامي." };
    }
    return dbErrorMessage(error);
  }

  refresh(parsed.data);
  return { ok: true };
}

export async function reorderPayoutsAction(input: ReorderInput): Promise<Result> {
  const user = await requireUser();
  const parsed = reorderSchema.safeParse(input);
  if (!parsed.success) return fromZodError(parsed.error);
  const { groupId, slotIds } = parsed.data;

  const { error } = await db().rpc("reorder_payouts", {
    p_actor_user_id: user.id,
    p_group_id: groupId,
    p_slot_ids: slotIds,
  });
  if (error) return dbErrorMessage(error);

  refresh(groupId);
  return { ok: true };
}
