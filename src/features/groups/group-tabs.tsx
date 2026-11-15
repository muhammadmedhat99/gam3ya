"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

export interface GroupTab {
  /** Path suffix after /groups/[id], "" for the overview. */
  segment: string;
  label: string;
}

/** Design "تابات (بتتسحب لو كتير)": underline tabs under the app bar. */
export function GroupTabs({ groupId, tabs }: { groupId: string; tabs: GroupTab[] }) {
  const pathname = usePathname();
  const base = `/groups/${groupId}`;
  return (
    <nav
      aria-label="أقسام الجمعية"
      className="sticky top-16 z-10 flex gap-0.5 overflow-x-auto border-b border-line bg-surface px-2 [scrollbar-width:none]"
    >
      {tabs.map((tab) => {
        const href = tab.segment ? `${base}/${tab.segment}` : base;
        const active = tab.segment ? pathname.startsWith(href) : pathname === base;
        return (
          <Link
            key={tab.segment}
            href={href}
            aria-current={active ? "page" : undefined}
            className={`flex h-12 shrink-0 items-center border-b-[3px] px-3.5 text-[15px] whitespace-nowrap ${
              active ? "border-brand-600 font-bold text-brand-700" : "border-transparent font-medium text-muted"
            }`}
          >
            {tab.label}
          </Link>
        );
      })}
    </nav>
  );
}
