import { z } from "zod";
import { isIsoDate } from "@/lib/dates";
import { parseAmountInput } from "@/lib/money";

/** Client-safe: used by the create wizard and re-run by the Server Action. */

export const MAX_SLOT_AMOUNT = 10_000_000;

const slotAmountSchema = z.string().transform((value, ctx) => {
  const amount = parseAmountInput(value);
  if (!amount || Number(amount) <= 0) {
    ctx.addIssue({ code: "custom", message: "اكتب قيمة الاسم بالجنيه، زي 1000" });
    return z.NEVER;
  }
  if (Number(amount) > MAX_SLOT_AMOUNT) {
    ctx.addIssue({ code: "custom", message: "القيمة كبيرة زيادة" });
    return z.NEVER;
  }
  return amount;
});

export const createGroupSchema = z
  .object({
    name: z.string().trim().min(2, "اكتب اسم الجمعية").max(80, "الاسم طويل زيادة"),
    slotAmount: slotAmountSchema,
    slotCount: z
      .number({ message: "اكتب عدد الأسامي" })
      .int()
      .min(2, "أقل عدد اسمين")
      .max(100, "أكتر عدد 100 اسم"),
    frequency: z.enum(["monthly", "semi_monthly"]),
    startDate: z.string().refine(isIsoDate, "اختار تاريخ أول دورة"),
    dueDay: z.number({ message: "اختار يوم التحصيل" }).int(),
  })
  .superRefine((v, ctx) => {
    const [min, max] = v.frequency === "monthly" ? [1, 28] : [0, 14];
    if (v.dueDay < min || v.dueDay > max) {
      ctx.addIssue({
        code: "custom",
        path: ["dueDay"],
        message:
          v.frequency === "monthly"
            ? "اختار يوم من 1 لـ 28"
            : "اختار من 0 لـ 14 يوم بعد بداية الدورة",
      });
    }
  });

export type CreateGroupInput = z.input<typeof createGroupSchema>;
export type CreateGroupValues = z.output<typeof createGroupSchema>;
