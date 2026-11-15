import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";
import { AppLogo } from "@/components/brand/app-logo";
import { LoginForm } from "@/features/auth/login-form";
import { getCurrentUser } from "@/server/auth/dal";

export const metadata: Metadata = { title: "تسجيل الدخول · جمعيتي" };

/** Design: "1 · تسجيل الدخول" (+ error, locked, forgot-password sheet). */
export default async function LoginPage() {
  const user = await getCurrentUser();
  if (user) redirect(user.mustChangePassword ? "/change-password" : "/");

  return (
    <main className="flex flex-1 flex-col gap-4 px-5 pt-4 pb-3">
      <div className="h-6" />
      <AppLogo />
      <div className="h-4" />
      <div className="flex flex-col gap-0.5">
        <h1 className="text-title-1 text-ink">سجّل دخول</h1>
        <p className="text-body-sm text-muted">ادخل برقم موبايلك وكلمة السر بتاعتك</p>
      </div>
      <LoginForm />
      <div className="flex-1" />
      <p className="flex items-center justify-center gap-1.5 text-body-sm text-muted">
        معندكش حساب؟
        <Link href="/register" className="inline-flex min-h-11 items-center font-bold text-brand-700">
          اعمل حساب جديد
        </Link>
      </p>
    </main>
  );
}
