import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";
import { BackIcon } from "@/components/ui/icons";
import { RegisterForm } from "@/features/auth/register-form";
import { getCurrentUser } from "@/server/auth/dal";

export const metadata: Metadata = { title: "حساب جديد · جمعيتي" };

/** Design: "2 · حساب جديد" (+ phone already has an account). */
export default async function RegisterPage() {
  const user = await getCurrentUser();
  if (user) redirect("/");

  return (
    <>
      <header className="flex min-h-16 shrink-0 items-center gap-1 p-2">
        <Link
          href="/login"
          aria-label="رجوع"
          className="button button--ghost button--icon-only text-ink"
        >
          <BackIcon size={22} />
        </Link>
        <h1 className="flex-1 text-title-2 text-ink">حساب جديد</h1>
      </header>
      <RegisterForm />
    </>
  );
}
