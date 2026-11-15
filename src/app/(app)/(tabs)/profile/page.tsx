import { Button } from "@heroui/react";
import type { Metadata } from "next";
import Link from "next/link";
import { PageHeader } from "@/components/layout/page-header";
import { ChevronIcon, LockIcon, ShieldCheckIcon } from "@/components/ui/icons";
import { formatEgyptPhone } from "@/lib/phone";
import { logoutAction } from "@/server/actions/auth";
import { requireUser } from "@/server/auth/dal";

export const metadata: Metadata = { title: "حسابي · جمعيتي" };

export default async function ProfilePage() {
  const user = await requireUser();

  return (
    <>
      <PageHeader title="حسابي" />
      <main className="flex flex-col gap-4 px-4 pt-4">
        <section className="flex items-center gap-3 rounded-lg border border-line bg-surface p-4 shadow-e1">
          <span className="flex size-14 shrink-0 items-center justify-center rounded-full bg-brand-50 text-title-2 text-brand-700">
            {user.fullName.charAt(0)}
          </span>
          <div className="flex min-w-0 flex-col">
            <span className="truncate text-title-3 text-ink">{user.fullName}</span>
            <span dir="ltr" className="tabular text-right text-body-sm text-muted">
              {formatEgyptPhone(user.phone)}
            </span>
          </div>
        </section>

        {user.isSuperAdmin && (
          <Link
            href="/admin"
            className="flex min-h-14 items-center gap-2 rounded-[14px] border border-brand-100 bg-brand-50 px-4 py-3 text-body-sm font-semibold text-brand-700"
          >
            <ShieldCheckIcon />
            <span className="flex-1">لوحة صاحب التطبيق</span>
            <ChevronIcon />
          </Link>
        )}

        <nav className="flex flex-col divide-y divide-line rounded-lg border border-line bg-surface shadow-e1">
          <Link href="/change-password" className="flex min-h-14 items-center gap-3 px-4">
            <LockIcon className="text-muted" />
            <span className="flex-1 text-body-sm font-semibold text-ink">غيّر كلمة السر</span>
            <ChevronIcon className="text-muted" />
          </Link>
        </nav>

        <form action={logoutAction}>
          <Button type="submit" variant="outline" fullWidth>
            تسجيل خروج
          </Button>
        </form>
      </main>
    </>
  );
}
