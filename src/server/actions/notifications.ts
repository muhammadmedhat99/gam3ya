"use server";

import { revalidatePath } from "next/cache";
import { db } from "@/lib/supabase/admin";
import { requireUser } from "@/server/auth/dal";

/** Marks the signed-in user's notifications as read (only theirs; user id comes from the session). */
export async function markAllNotificationsReadAction(): Promise<void> {
  const user = await requireUser();
  const { error } = await db()
    .from("notifications")
    .update({ read_at: new Date().toISOString() })
    .eq("user_id", user.id)
    .is("read_at", null);
  if (error) throw new Error(`mark read: ${error.message}`);
  revalidatePath("/", "layout");
}
