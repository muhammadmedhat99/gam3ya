"use client";

import { zodResolver } from "@hookform/resolvers/zod";
import { Button } from "@heroui/react";
import { useEffect, useState } from "react";
import { useForm } from "react-hook-form";
import type { z } from "zod";
import { FormTextField } from "@/components/forms/form-text-field";
import { LockIcon, PhoneIcon } from "@/components/ui/icons";
import { Notice } from "@/components/ui/notice";
import { loginSchema, type LoginInput } from "@/lib/validation/auth";
import { loginAction } from "@/server/actions/auth";
import type { LoginResult } from "@/server/actions/result";
import { ForgotPasswordSheet } from "./forgot-password-sheet";

function attemptsLeftText(left: number): string {
  if (left === 1) return "اتأكد منهم وجرب تاني. فاضلك محاولة واحدة قبل ما الدخول يتقفل شوية.";
  if (left === 2) return "اتأكد منهم وجرب تاني. فاضلك محاولتين قبل ما الدخول يتقفل شوية.";
  return "اتأكد منهم وجرب تاني.";
}

/** Seconds until `until`, ticking every second; 0 when passed. */
function useCountdown(until: string | null): number {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    if (!until) return;
    const id = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(id);
  }, [until]);
  return until ? Math.max(0, Math.ceil((new Date(until).getTime() - now) / 1000)) : 0;
}

function mmss(seconds: number): string {
  const m = Math.floor(seconds / 60);
  const s = seconds % 60;
  return `${m}:${String(s).padStart(2, "0")}`;
}

export function LoginForm() {
  const [result, setResult] = useState<LoginResult | null>(null);
  const lockedUntil = result?.kind === "locked" ? result.until : null;
  const secondsLeft = useCountdown(lockedUntil);
  const isLocked = lockedUntil !== null && secondsLeft > 0;

  const { control, handleSubmit, formState } = useForm<
    LoginInput,
    unknown,
    z.output<typeof loginSchema>
  >({
    resolver: zodResolver(loginSchema),
    defaultValues: { phone: "", password: "" },
  });

  const onSubmit = handleSubmit(async (values) => {
    setResult(null);
    // On success the action redirects; otherwise it returns what to show.
    setResult((await loginAction(values)) ?? null);
  });

  const wrongCredentials = result?.kind === "invalid";

  return (
    <form onSubmit={onSubmit} noValidate className="flex flex-col gap-4">
      {wrongCredentials && (
        <Notice title="رقم الموبايل أو كلمة السر غلط">{attemptsLeftText(result.attemptsLeft)}</Notice>
      )}
      {isLocked && (
        <Notice title="الدخول اتقفل مؤقتًا" icon={<LockIcon />}>
          جربت كذا مرة ببيانات غلط. عشان أمان حسابك استنى 15 دقيقة وجرب تاني، أو كلّم صاحب التطبيق لو
          محتاج مساعدة.
        </Notice>
      )}
      {result?.kind === "error" && <Notice title={result.message} />}

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
        isDisabled={isLocked}
        forceInvalid={wrongCredentials}
      />
      <FormTextField
        control={control}
        name="password"
        label="كلمة السر"
        type="password"
        autoComplete="current-password"
        placeholder="اكتب كلمة السر"
        isDisabled={isLocked}
        forceInvalid={wrongCredentials}
      />

      <ForgotPasswordSheet />

      <Button
        type="submit"
        size="lg"
        fullWidth
        isPending={formState.isSubmitting}
        isDisabled={isLocked}
      >
        {isLocked ? (
          <>
            <LockIcon />
            <span className="tabular">تقدر تجرب تاني بعد {mmss(secondsLeft)}</span>
          </>
        ) : (
          "سجّل دخول"
        )}
      </Button>
    </form>
  );
}
