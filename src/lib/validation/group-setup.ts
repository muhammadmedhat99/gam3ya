import { z } from "zod";
import { parseAmountInput } from "@/lib/money";
import { phoneSchema } from "./auth";

/** Client-safe schemas for the association setup screens; re-run by the Server Actions. */

const uuid = z.string().uuid();

export const addMemberSchema = z.object({
  groupId: uuid,
  displayName: z.string().trim().min(1, "اكتب اسم العضو").max(60, "الاسم طويل زيادة"),
  phone: phoneSchema,
  /** Set after the admin confirmed it's the same person as the registered account. */
  confirmLink: z.boolean(),
});
export type AddMemberInput = z.input<typeof addMemberSchema>;

export const reviewLinkRequestSchema = z.object({
  groupId: uuid,
  requestId: uuid,
  approve: z.boolean(),
});
export type ReviewLinkRequestInput = z.input<typeof reviewLinkRequestSchema>;

const allocationAmount = z.string().transform((value, ctx) => {
  const amount = parseAmountInput(value);
  if (!amount || Number(amount) <= 0) {
    ctx.addIssue({ code: "custom", message: "اكتب مبلغ أكبر من صفر" });
    return z.NEVER;
  }
  return amount;
});

export const setAllocationsSchema = z.object({
  groupId: uuid,
  slotId: uuid,
  allocations: z
    .array(z.object({ memberId: uuid, amount: allocationAmount }))
    .max(20)
    .refine((list) => new Set(list.map((a) => a.memberId)).size === list.length, "نفس الشخص اتكرر"),
});
export type SetAllocationsInput = z.input<typeof setAllocationsSchema>;

export const reorderSchema = z.object({
  groupId: uuid,
  slotIds: z.array(uuid).min(2).max(100),
});
export type ReorderInput = z.input<typeof reorderSchema>;
