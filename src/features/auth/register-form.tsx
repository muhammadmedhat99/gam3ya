"use client";

import { zodResolver } from "@hookform/resolvers/zod";
import { Button } from "@heroui/react";
import Link from "next/link";
import { useState } from "react";
import { useForm, useWatch } from "react-hook-form";
import type { z } from "zod";
import { applyActionErrors } from "@/components/forms/apply-action-errors";
import { FormTextField } from "@/components/forms/form-text-field";
import { PhoneIcon } from "@/components/ui/icons";
import { Notice } from "@/components/ui/notice";
import { PASSWORD_MIN_LENGTH } from "@/lib/auth/password-policy";
import { registerSchema, type RegisterInput } from "@/lib/validation/auth";
import { registerAction } from "@/server/actions/auth";

export function RegisterForm() {
  const [formError, setFormError] = useState<string | null>(null);
  const [phoneTaken, setPhoneTaken] = useState(false);
  const { control, handleSubmit, setError, formState } = useForm<
    RegisterInput,
    unknown,
    z.output<typeof registerSchema>
  >({
    resolver: zodResolver(registerSchema),
    defaultValues: { fullName: "", phone: "", password: "", confirmPassword: "" },
  });
  const password = useWatch({ control, name: "password" }) ?? "";

  const onSubmit = handleSubmit(async (values) => {
    setFormError(null);
    setPhoneTaken(false);
    const result = await registerAction(values);
    setPhoneTaken(Boolean(result?.phoneTaken));
    setFormError(applyActionErrors(result, setError));
  });

  return (
    <form onSubmit={onSubmit} noValidate className="flex min-h-0 flex-1 flex-col">
      <div className="flex flex-1 flex-col gap-4 px-4 pt-1 pb-4">
        <p className="text-body-sm text-muted">
          اعمل حسابك بنفس الرقم اللي الأدمن ضايفك بيه، عشان جمعياتك تظهرلك.
        </p>
        {formError && <Notice title={formError} />}
        <FormTextField control={control} name="fullName" label="الاسم بالكامل" autoComplete="name" />
        <div className="flex flex-col">
          <FormTextField
            control={control}
            name="phone"
            label="رقم الموبايل"
            type="tel"
            inputMode="tel"
            ltr
            autoComplete="tel"
            placeholder="010 1234 5678"
            icon={<PhoneIcon />}
            hint={{ text: "الرقم اللي الأدمن ضايفك بيه" }}
          />
          {phoneTaken && (
            <p className="flex items-center gap-1.5 text-caption text-muted">
              ده رقمك؟
              <Link
                href="/login"
                className="inline-flex min-h-11 items-center text-body-sm font-bold text-brand-700"
              >
                سجّل دخول بيه
              </Link>
            </p>
          )}
        </div>
        <FormTextField
          control={control}
          name="password"
          label="كلمة السر"
          type="password"
          autoComplete="new-password"
          hint={{ text: `${PASSWORD_MIN_LENGTH} حروف أو أكتر`, met: password.length >= PASSWORD_MIN_LENGTH }}
        />
        <FormTextField
          control={control}
          name="confirmPassword"
          label="تأكيد كلمة السر"
          type="password"
          autoComplete="new-password"
          placeholder="اكتبها تاني"
        />
      </div>

      <div className="sticky bottom-0 flex flex-col gap-1 bg-paper px-4 py-3">
        <Button type="submit" size="lg" fullWidth isPending={formState.isSubmitting}>
          اعمل الحساب
        </Button>
        <p className="flex items-center justify-center gap-1.5 text-body-sm text-muted">
          عندك حساب؟
          <Link href="/login" className="inline-flex min-h-11 items-center font-bold text-brand-700">
            سجّل دخول
          </Link>
        </p>
      </div>
    </form>
  );
}
