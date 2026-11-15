import { z } from "zod";
import { isIsoDate } from "@/lib/dates";
import { parseAmountInput } from "@/lib/money";

const uuid = z.string().uuid();

export const recordPayoutSchema = z.object({
  groupId: uuid,
  cycleId: uuid,
  memberId: uuid,
  amount: z.string().transform((value, ctx) => {
    const amount = parseAmountInput(value);
    if (!amount || Number(amount) <= 0) {
      ctx.addIssue({ code: "custom", message: "اكتب المبلغ اللي اتسلّم" });
      return z.NEVER;
    }
    return amount;
  }),
  paidOn: z.string().refine(isIsoDate, "اختار التاريخ"),
  method: z.enum(["cash", "transfer"]),
  note: z.string().trim().max(200, "الملاحظة طويلة زيادة").optional(),
  idempotencyKey: uuid,
});
export type RecordPayoutInput = z.input<typeof recordPayoutSchema>;

export const reversePayoutSchema = z.object({
  groupId: uuid,
  disbursementId: uuid,
  reason: z.string().trim().min(3, "اكتب سبب التصحيح").max(200, "السبب طويل زيادة"),
});
export type ReversePayoutInput = z.input<typeof reversePayoutSchema>;
