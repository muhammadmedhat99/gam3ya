import type { Metadata } from "next";
import { PageHeader } from "@/components/layout/page-header";
import { BellIcon } from "@/components/ui/icons";
import { EmptyState } from "@/components/ui/states";
import { timeAgo } from "@/lib/dates";
import { NotificationsList } from "@/features/notifications/notifications-list";
import { requireUser } from "@/server/auth/dal";
import { listNotifications } from "@/server/services/notifications";

export const metadata: Metadata = { title: "الإشعارات · جمعيتي" };

export default async function NotificationsPage() {
  const user = await requireUser();
  const items = await listNotifications(user.id);

  return (
    <>
      <PageHeader title="الإشعارات" />
      <main className="px-4 pt-4 pb-6">
        {items.length === 0 ? (
          <EmptyState
            icon={<BellIcon size={30} />}
            title="مفيش إشعارات"
            description="هنقولك هنا لما دورك يقرب، أو الأدمن يوافق على ربط حسابك، أو جمعيتك تبدأ."
          />
        ) : (
          <NotificationsList
            hasUnread={items.some((n) => !n.read)}
            items={items.map((n) => ({
              id: n.id,
              title: n.title,
              body: n.body,
              href: n.href,
              ago: timeAgo(n.createdAt),
              read: n.read,
            }))}
          />
        )}
      </main>
    </>
  );
}
