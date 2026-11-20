"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { Suspense, use, type ReactNode } from "react";
import { BellIcon, CoinsIcon, HomeIcon, UserIcon } from "@/components/ui/icons";
import { LinkPendingBar } from "./link-pending";

const TABS: { href: string; label: string; icon: ReactNode; match: (p: string) => boolean }[] = [
  { href: "/", label: "الرئيسية", icon: <HomeIcon size={22} />, match: (p) => p === "/" },
  {
    href: "/groups",
    label: "جمعياتي",
    icon: <CoinsIcon size={22} />,
    match: (p) => p.startsWith("/groups"),
  },
  {
    href: "/notifications",
    label: "الإشعارات",
    icon: <BellIcon size={22} />,
    match: (p) => p.startsWith("/notifications"),
  },
  { href: "/profile", label: "حسابي", icon: <UserIcon size={22} />, match: (p) => p.startsWith("/profile") },
];

/** Streams in after the nav is already on screen. */
function UnreadBadge({ count }: { count: Promise<number> }) {
  const unread = use(count);
  if (unread <= 0) return null;
  return (
    <span className="absolute -top-1 inset-e-2.5 flex h-4.5 min-w-4.5 items-center justify-center rounded-full border-2 border-surface bg-brand-600 px-1 text-[0.6875rem] font-bold text-white">
      {unread > 99 ? "99+" : unread}
      <span className="sr-only"> إشعارات جديدة</span>
    </span>
  );
}

/** Design "Bottom navigation · 4 تابات". */
export function BottomNav({ unread }: { unread: Promise<number> }) {
  const pathname = usePathname();
  return (
    <nav
      aria-label="التنقل الرئيسي"
      className="fixed inset-x-0 bottom-0 z-30 mx-auto grid h-(--nav-height) max-w-md grid-cols-4 border-t border-line bg-surface px-2 pt-1 pb-[max(14px,env(safe-area-inset-bottom))]"
    >
      {TABS.map((tab) => {
        const active = tab.match(pathname);
        return (
          <Link
            key={tab.href}
            href={tab.href}
            aria-current={active ? "page" : undefined}
            className={`relative flex min-h-14 min-w-0 flex-col items-center gap-0.75 pt-1.5 pb-1 ${
              active ? "text-brand-700" : "text-muted"
            }`}
          >
            <LinkPendingBar className="inset-x-6 top-0 h-0.75" />
            <span
              className={`relative flex h-8 w-full max-w-15 shrink-0 items-center justify-center rounded-full ${
                active ? "bg-brand-100" : ""
              }`}
            >
              {tab.icon}
              {tab.href === "/notifications" && (
                <Suspense fallback={null}>
                  <UnreadBadge count={unread} />
                </Suspense>
              )}
            </span>
            <span className={`w-full truncate text-center text-micro ${active ? "font-bold" : ""}`}>{tab.label}</span>
          </Link>
        );
      })}
    </nav>
  );
}
