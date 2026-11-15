import { BottomNav } from "@/components/layout/bottom-nav";
import { requireUser } from "@/server/auth/dal";
import { countUnread } from "@/server/services/notifications";

/**
 * Screens with the bottom navigation (design: 4 tabs, unread badge on الإشعارات).
 * The unread count is streamed: the nav renders immediately and the badge fills in.
 */
export default async function TabsLayout({ children }: LayoutProps<"/">) {
  const user = await requireUser();
  const unread = countUnread(user.id);
  return (
    <>
      <div className="flex flex-1 flex-col pb-[calc(var(--nav-height)+16px)]">{children}</div>
      <BottomNav unread={unread} />
    </>
  );
}
