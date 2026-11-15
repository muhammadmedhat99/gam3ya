"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { db } from "@/lib/supabase/admin";
import { requireSuperAdmin } from "@/server/auth/dal";
import type { ActionError } from "./result";

/**
 * Super-admin account actions. requireSuperAdmin() checks the session; the
 * database functions check is_super_admin again and audit every change.
 */

type Result = { ok: true } | ActionError;
const uuid = z.string().uuid();

function done(): Result {
  revalidatePath("/admin");
  return { ok: true };
}

export async function adminResetPasswordAction(input: { userId: string }): Promise<Result> {
  const admin = await requireSuperAdmin();
  const userId = uuid.safeParse(input.userId);
  if (!userId.success) return { error: "مستخدم مش موجود." };
  const { error } = await db().rpc("admin_reset_password", {
    p_target_user_id: userId.data,
    p_actor_user_id: admin.id,
  });
  if (error) return { error: "مقدرناش نعمل reset. جرب تاني." };
  return done();
}

const recoverSchema = z.object({
  userId: uuid,
  fullName: z.string().trim().min(2, "اكتب اسم صاحب الرقم").max(100),
  email: z.string().trim().max(200).optional(),
  note: z.string().trim().min(3, "اكتب إزاي اتأكدت من صاحب الرقم").max(300),
});

export async function adminRecoverAccountAction(input: z.input<typeof recoverSchema>): Promise<Result> {
  const admin = await requireSuperAdmin();
  const parsed = recoverSchema.safeParse(input);
  if (!parsed.success) return { error: parsed.error.issues[0]?.message ?? "راجع البيانات." };
  const v = parsed.data;
  const { error } = await db().rpc("admin_recover_account", {
    p_target_user_id: v.userId,
    p_new_full_name: v.fullName,
    p_new_email: v.email ?? "",
    p_actor_user_id: admin.id,
    p_note: v.note,
  });
  if (error) {
    if (error.code === "23505") return { error: "الإيميل ده مستخدم في حساب تاني." };
    return { error: "مقدرناش نسترجع الحساب. جرب تاني." };
  }
  return done();
}

const statusSchema = z.object({ userId: uuid, status: z.enum(["active", "blocked"]), note: z.string().trim().max(300).optional() });

export async function adminSetUserStatusAction(input: z.input<typeof statusSchema>): Promise<Result> {
  const admin = await requireSuperAdmin();
  const parsed = statusSchema.safeParse(input);
  if (!parsed.success) return { error: "راجع البيانات." };
  const { error } = await db().rpc("admin_set_user_status", {
    p_actor_user_id: admin.id,
    p_target_user_id: parsed.data.userId,
    p_status: parsed.data.status,
    p_note: parsed.data.note ?? null,
  });
  if (error) {
    if (error.message.includes("cannot be blocked")) return { error: "حساب صاحب التطبيق مينفعش يتوقف." };
    return { error: "حصلت مشكلة. جرب تاني." };
  }
  return done();
}
