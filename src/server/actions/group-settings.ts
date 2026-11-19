"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { z } from "zod";
import { db } from "@/lib/supabase/admin";
import { createGroupSchema, type CreateGroupInput } from "@/lib/validation/groups";
import { requireUser } from "@/server/auth/dal";
import { fromZodError, type ActionError } from "./result";

/**
 * Settings tab mutations. The database functions re-check the actor's role
 * (owner for admins, owner/admin for collectors and settings) and the rules.
 */

type Result = { ok: true } | ActionError;
const uuid = z.string().uuid();

function refresh(groupId: string) {
  revalidatePath(`/groups/${groupId}`, "layout");
  revalidatePath("/");
  revalidatePath("/groups");
}

function message(error: { code?: string; message: string }): ActionError {
  if (error.code === "42501") {
    return {
      error: error.message.includes("only the owner")
        ? "صاحب الجمعية بس هو اللي يضيف أو يشيل أدمن."
        : "مش مسموحلك تعمل ده في الجمعية دي.",
    };
  }
  if (error.message.includes("still have shares")) {
    return { fieldErrors: { slotCount: "في أسامي هتتشال وعليها حصص. فضّيها الأول من الأسامي." } };
  }
  if (error.message.includes("locked")) return { error: "قيمة الاسم والمواعيد اتقفلت بعد ما الجمعية بدأت." };
  if (error.message.includes("linked account")) return { error: "الدور بيتدّى لعضو عنده حساب مربوط بالجمعية." };
  if (error.message.includes("owner role")) return { error: "صاحب الجمعية مينفعش يتغيّر دوره." };
  if (error.message.includes("not started")) return { error: "آخر دورة لسه مبدأتش." };
  return { error: "حصلت مشكلة. جرب تاني." };
}

const settingsSchema = createGroupSchema.and(z.object({ groupId: uuid }));

export async function updateGroupSettingsAction(input: CreateGroupInput & { groupId: string }): Promise<Result> {
  const user = await requireUser();
  const parsed = settingsSchema.safeParse(input);
  if (!parsed.success) return fromZodError(parsed.error);
  const v = parsed.data;

  const { error } = await db().rpc("update_group_settings", {
    p_actor_user_id: user.id,
    p_group_id: v.groupId,
    p_name: v.name,
    p_slot_amount: v.slotAmount,
    p_target_slot_count: v.slotCount,
    p_frequency: v.frequency,
    p_start_date: v.startDate,
    p_collection_due_day: v.dueDay,
  });
  if (error) return message(error);
  refresh(v.groupId);
  return { ok: true };
}

const roleSchema = z.object({ groupId: uuid, userId: uuid, role: z.enum(["admin", "collector"]) });

export async function setGroupRoleAction(input: z.input<typeof roleSchema>): Promise<Result> {
  const user = await requireUser();
  const parsed = roleSchema.safeParse(input);
  if (!parsed.success) return { error: "اختار العضو والدور." };
  const { error } = await db().rpc("set_group_role", {
    p_actor_user_id: user.id,
    p_group_id: parsed.data.groupId,
    p_user_id: parsed.data.userId,
    p_role: parsed.data.role,
  });
  if (error) return message(error);
  refresh(parsed.data.groupId);
  return { ok: true };
}

const removeSchema = z.object({ groupId: uuid, userId: uuid });

export async function removeGroupRoleAction(input: z.input<typeof removeSchema>): Promise<Result> {
  const user = await requireUser();
  const parsed = removeSchema.safeParse(input);
  if (!parsed.success) return { error: "حصلت مشكلة. جرب تاني." };
  const { error } = await db().rpc("remove_group_role", {
    p_actor_user_id: user.id,
    p_group_id: parsed.data.groupId,
    p_user_id: parsed.data.userId,
  });
  if (error) return message(error);
  refresh(parsed.data.groupId);
  return { ok: true };
}

const deleteSchema = z.object({ groupId: uuid, confirmName: z.string() });

/**
 * Soft delete (owner only; draft or completed). The typed name must match the
 * group's name. Financial records stay in the database (AGENTS.md rule 11).
 */
export async function deleteGroupAction(input: z.input<typeof deleteSchema>): Promise<ActionError> {
  const user = await requireUser();
  const parsed = deleteSchema.safeParse(input);
  if (!parsed.success) return { error: "حصلت مشكلة. جرب تاني." };

  const { data: group } = await db()
    .from("groups")
    .select("name")
    .eq("id", parsed.data.groupId)
    .is("deleted_at", null)
    .maybeSingle<{ name: string }>();
  if (!group) return { error: "الجمعية دي مش موجودة." };
  if (parsed.data.confirmName.trim() !== group.name.trim()) {
    return { fieldErrors: { confirmName: "الاسم مش مطابق لاسم الجمعية" } };
  }

  const { error } = await db().rpc("delete_group", { p_actor_user_id: user.id, p_group_id: parsed.data.groupId });
  if (error) {
    if (error.code === "42501") return { error: "صاحب الجمعية بس هو اللي يقدر يمسحها." };
    if (error.message.includes("draft or completed")) {
      return { error: "الجمعية الشغالة مينفعش تتمسح. تتمسح وهي مسودة أو بعد ما تخلص." };
    }
    return { error: "حصلت مشكلة. جرب تاني." };
  }

  revalidatePath("/", "layout");
  redirect("/groups");
}

export async function completeGroupAction(input: { groupId: string }): Promise<Result> {
  const user = await requireUser();
  const parsed = uuid.safeParse(input.groupId);
  if (!parsed.success) return { error: "حصلت مشكلة. جرب تاني." };
  const { error } = await db().rpc("complete_group", { p_actor_user_id: user.id, p_group_id: parsed.data });
  if (error) return message(error);
  refresh(parsed.data);
  return { ok: true };
}
