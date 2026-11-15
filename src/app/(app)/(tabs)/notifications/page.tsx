import type { Metadata } from "next";
import { PageHeader } from "@/components/layout/page-header";
import { BellIcon } from "@/components/ui/icons";
import { EmptyState } from "@/components/ui/states";
import { requireUser } from "@/server/auth/dal";

export const metadata: Metadata = { title: "الإشعارات · جمعيتي" };

/** In-app notifications arrive with the notifications migration. */
export default async function NotificationsPage() {
  await requireUser();
  return (
    <>
      <PageHeader title="الإشعارات" />
      <main className="px-4 pt-4">
        <EmptyState
          icon={<BellIcon size={30} />}
          title="مفيش إشعارات"
          description="هنقولك هنا لما دورك يقرب أو الأدمن يوافق على ربط حسابك."
        />
      </main>
    </>
  );
}
