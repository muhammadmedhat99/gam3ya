import { Button } from "@heroui/react";
import type { Metadata } from "next";
import Link from "next/link";
import { BackIcon, LockIcon } from "@/components/ui/icons";
import { ChangePasswordForm } from "@/features/auth/change-password-form";
import { logoutAction } from "@/server/actions/auth";
import { requireUser } from "@/server/auth/dal";

export const metadata: Metadata = { title: "كلمة السر · جمعيتي" };

/**
 * Design: "3 · تغيير كلمة السر الإجباري" after a super-admin reset.
 * The same form (with "current password") serves a normal change from the profile.
 */
export default async function ChangePasswordPage() {
  const user = await requireUser({ allowPendingPasswordChange: true });

  if (!user.mustChangePassword) {
    return (
      <>
        <header className="flex min-h-16 shrink-0 items-center gap-1 p-2">
          <Link href="/profile" aria-label="رجوع" className="button button--ghost button--icon-only text-ink">
            <BackIcon size={22} />
          </Link>
          <h1 className="flex-1 text-title-2 text-ink">غيّر كلمة السر</h1>
        </header>
        <main className="flex flex-col gap-4 px-4 pt-1 pb-4">
          <p className="text-body-sm text-muted">هنخرّجك من أي جهاز تاني بعد التغيير.</p>
          <ChangePasswordForm afterReset={false} />
        </main>
      </>
    );
  }

  return (
    <main className="flex flex-1 flex-col gap-5 px-5 py-4">
      <div className="h-8" />
      <span className="flex size-16 items-center justify-center rounded-[20px] bg-brand-50 text-brand-700">
        <LockIcon size={30} />
      </span>
      <div className="flex flex-col gap-1.5">
        <h1 className="text-title-1 text-ink">اختار كلمة سر جديدة</h1>
        <p className="text-body text-body">
          صاحب التطبيق عملّك كلمة سر مؤقتة. اختار واحدة جديدة تخصك إنت بس، وبعدها هتكمّل عادي. خطوة
          واحدة بس.
        </p>
      </div>
      <ChangePasswordForm afterReset />
      <div className="flex-1" />
      <p className="flex items-center justify-center gap-1.5 text-caption text-muted">
        <LockIcon size={16} />
        لازم تخلص الخطوة دي الأول قبل ما تفتح أي حاجة تانية
      </p>
      <form action={logoutAction} className="-mt-2 flex justify-center">
        <Button type="submit" variant="ghost">
          تسجيل خروج
        </Button>
      </form>
    </main>
  );
}
