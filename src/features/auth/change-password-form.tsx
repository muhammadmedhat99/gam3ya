"use client";

import { zodResolver } from "@hookform/resolvers/zod";
import { Button } from "@heroui/react";
import { useState } from "react";
import { useForm, useWatch } from "react-hook-form";
import type { z } from "zod";
import { applyActionErrors } from "@/components/forms/apply-action-errors";
import { FormTextField } from "@/components/forms/form-text-field";
import { Notice } from "@/components/ui/notice";
import { checkPasswordPolicy, PASSWORD_MIN_LENGTH } from "@/lib/auth/password-policy";
import { changePasswordSchema, type ChangePasswordInput } from "@/lib/validation/auth";
import { changePasswordAction } from "@/server/actions/auth";

/** `afterReset`: signed in with the temporary password, so "current password" is skipped. */
export function ChangePasswordForm({ afterReset }: { afterReset: boolean }) {
  const [formError, setFormError] = useState<string | null>(null);
  const { control, handleSubmit, setError, formState } = useForm<
    ChangePasswordInput,
    unknown,
    z.output<typeof changePasswordSchema>
  >({
    resolver: zodResolver(changePasswordSchema),
    defaultValues: { currentPassword: "", newPassword: "", confirmPassword: "" },
  });
  const newPassword = useWatch({ control, name: "newPassword" }) ?? "";
  const confirmPassword = useWatch({ control, name: "confirmPassword" }) ?? "";
  const longEnough = newPassword.length >= PASSWORD_MIN_LENGTH;
  const matches = confirmPassword.length > 0 && confirmPassword === newPassword;
  const ready = checkPasswordPolicy(newPassword).ok && matches;

  const onSubmit = handleSubmit(async (values) => {
    setFormError(null);
    const payload = afterReset ? { ...values, currentPassword: undefined } : values;
    setFormError(applyActionErrors(await changePasswordAction(payload), setError));
  });

  return (
    <form onSubmit={onSubmit} noValidate className="flex flex-col gap-5">
      {formError && <Notice title={formError} />}
      {!afterReset && (
        <FormTextField
          control={control}
          name="currentPassword"
          label="كلمة السر الحالية"
          type="password"
          autoComplete="current-password"
        />
      )}
      <FormTextField
        control={control}
        name="newPassword"
        label="كلمة السر الجديدة"
        type="password"
        autoComplete="new-password"
        hint={{ text: `${PASSWORD_MIN_LENGTH} حروف أو أكتر`, met: longEnough }}
      />
      <FormTextField
        control={control}
        name="confirmPassword"
        label="تأكيد كلمة السر"
        type="password"
        autoComplete="new-password"
        hint={{ text: "الكلمتين زي بعض", met: matches }}
      />
      <Button
        type="submit"
        size="lg"
        fullWidth
        isDisabled={!ready}
        isPending={formState.isSubmitting}
      >
        {afterReset ? "احفظ وكمّل" : "احفظ كلمة السر"}
      </Button>
    </form>
  );
}
