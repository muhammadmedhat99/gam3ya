"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import type { ReactNode } from "react";
import { BellIcon, CoinsIcon, HomeIcon, UserIcon } from "@/components/ui/icons";

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

/** Design "Bottom navigation · 4 تابات". */
export function BottomNav() {
  const pathname = usePathname();
  return (
    <nav
      aria-label="التنقل الرئيسي"
      className="fixed inset-x-0 bottom-0 z-30 mx-auto grid max-w-md grid-cols-4 border-t border-line bg-surface px-2 pt-1 pb-[max(14px,env(safe-area-inset-bottom))]"
    >
      {TABS.map((tab) => {
        const active = tab.match(pathname);
        return (
          <Link
            key={tab.href}
            href={tab.href}
            aria-current={active ? "page" : undefined}
            className={`flex min-h-14 flex-col items-center gap-[3px] pt-1.5 pb-1 ${
              active ? "text-brand-700" : "text-muted"
            }`}
          >
            <span
              className={`flex h-8 w-[60px] items-center justify-center rounded-full ${
                active ? "bg-brand-100" : ""
              }`}
            >
              {tab.icon}
            </span>
            <span className={`text-micro ${active ? "font-bold" : ""}`}>{tab.label}</span>
          </Link>
        );
      })}
    </nav>
  );
}
