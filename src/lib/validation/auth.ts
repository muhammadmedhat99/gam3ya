import { z } from "zod";
import { checkPasswordPolicy } from "@/lib/auth/password-policy";
import { normalizeEgyptPhone } from "@/lib/phone";

/** Client-safe: used by the forms (React Hook Form) and re-run by the Server Actions. */

export const phoneSchema = z.string().transform((value, ctx) => {
  const phone = normalizeEgyptPhone(value);
  if (!phone) {
    ctx.addIssue({ code: "custom", message: "اكتب رقم موبايل مصري صحيح، زي 01012345678" });
    return z.NEVER;
  }
  return phone;
});

const newPasswordSchema = z.string().superRefine((value, ctx) => {
  const result = checkPasswordPolicy(value);
  if (!result.ok) ctx.addIssue({ code: "custom", message: result.message });
});

const fullNameSchema = z
  .string()
  .trim()
  .min(2, "اكتب اسمك (حرفين على الأقل)")
  .max(100, "الاسم طويل زيادة");

export const registerSchema = z
  .object({
    fullName: fullNameSchema,
    phone: phoneSchema,
    password: newPasswordSchema,
    confirmPassword: z.string(),
  })
  .refine((v) => v.password === v.confirmPassword, {
    path: ["confirmPassword"],
    message: "كلمتين السر مش زي بعض",
  });

export const loginSchema = z.object({
  phone: phoneSchema,
  password: z.string().min(1, "اكتب كلمة السر"),
});

/** currentPassword is optional only while the server says must_change_password. */
export const changePasswordSchema = z
  .object({
    currentPassword: z.string().optional(),
    newPassword: newPasswordSchema,
    confirmPassword: z.string(),
  })
  .refine((v) => v.newPassword === v.confirmPassword, {
    path: ["confirmPassword"],
    message: "كلمتين السر مش زي بعض",
  })
  .refine((v) => !v.currentPassword || v.currentPassword !== v.newPassword, {
    path: ["newPassword"],
    message: "اختار كلمة سر جديدة غير القديمة",
  });

export type RegisterInput = z.input<typeof registerSchema>;
export type LoginInput = z.input<typeof loginSchema>;
export type ChangePasswordInput = z.input<typeof changePasswordSchema>;
