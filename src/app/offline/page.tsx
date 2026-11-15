import type { Metadata } from "next";
import { AppLogo } from "@/components/brand/app-logo";
import { RetryButton } from "./retry-button";

export const metadata: Metadata = { title: "مفيش نت · جمعيتي" };
export const dynamic = "force-static";

/** Shown by the service worker when a page can't load. Static, no user data. */
export default function OfflinePage() {
  return (
    <main className="mx-auto flex min-h-dvh w-full max-w-md flex-col justify-center gap-6 bg-paper px-5">
      <AppLogo />
      <div className="flex flex-col gap-2">
        <h1 className="text-title-1 text-ink">مفيش اتصال بالنت</h1>
        <p className="text-body text-body">
          جمعيتي محتاجة نت عشان تعرض بيانات الجمعيات وتسجّل أي حاجة. مفيش أي تسجيل بيتعمل وإنت أوفلاين، فمحدش هيتسجله
          حاجة بالغلط.
        </p>
      </div>
      <RetryButton />
    </main>
  );
}
