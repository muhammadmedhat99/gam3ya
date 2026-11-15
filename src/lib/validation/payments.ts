import { z } from "zod";
import { isIsoDate } from "@/lib/dates";
import { parseAmountInput } from "@/lib/money";

/** Client-safe schemas for the admin collection screens; re-run by the Server Actions. */

const uuid = z.string().uuid();

export const recordPaymentSchema = z.object({
  groupId: uuid,
  obligationId: uuid,
  amount: z.string().transform((value, ctx) => {
    const amount = parseAmountInput(value);
    if (!amount || Number(amount) <= 0) {
      ctx.addIssue({ code: "custom", message: "اكتب المبلغ اللي اتدفع" });
      return z.NEVER;
    }
    return amount;
  }),
  paidOn: z.string().refine(isIsoDate, "اختار التاريخ"),
  method: z.enum(["cash", "transfer"]),
  note: z.string().trim().max(200, "الملاحظة طويلة زيادة").optional(),
  /** Generated once per opened sheet so a double tap records once. */
  idempotencyKey: uuid,
});
export type RecordPaymentInput = z.input<typeof recordPaymentSchema>;

export const reversePaymentSchema = z.object({
  groupId: uuid,
  paymentId: uuid,
  reason: z.string().trim().min(3, "اكتب سبب التصحيح").max(200, "السبب طويل زيادة"),
});
export type ReversePaymentInput = z.input<typeof reversePaymentSchema>;
