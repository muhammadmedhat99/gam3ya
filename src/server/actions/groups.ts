"use server";

import { redirect } from "next/navigation";
import { db } from "@/lib/supabase/admin";
import { createGroupSchema, type CreateGroupInput } from "@/lib/validation/groups";
import { requireUser } from "@/server/auth/dal";
import { fromZodError, type ActionError } from "./result";

export async function createGroupAction(input: CreateGroupInput): Promise<ActionError> {
  const user = await requireUser();

  const parsed = createGroupSchema.safeParse(input);
  if (!parsed.success) return fromZodError(parsed.error);
  const v = parsed.data;

  // create_group re-checks the actor and creates the owner role + N slots atomically.
  const { data: groupId, error } = await db().rpc("create_group", {
    p_actor_user_id: user.id,
    p_name: v.name,
    p_slot_amount: v.slotAmount,
    p_target_slot_count: v.slotCount,
    p_frequency: v.frequency,
    p_start_date: v.startDate,
    p_collection_due_day: v.dueDay,
  });
  if (error) {
    if (error.code === "23514" || error.code === "22023") {
      return { error: "في بيانات مش مظبوطة، راجعها وجرب تاني." };
    }
    throw new Error(`create_group failed: ${error.message}`);
  }

  redirect(`/groups/${groupId as string}`);
}
