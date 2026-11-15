"use client";

import Link from "next/link";
import { useEffect } from "react";
import { ChevronIcon } from "@/components/ui/icons";
import { markAllNotificationsReadAction } from "@/server/actions/notifications";

export interface NotificationRow {
  id: string;
  title: string;
  body: string;
  href: string | null;
  ago: string;
  read: boolean;
}

/** Shows the inbox, then marks everything read once it has been seen. */
export function NotificationsList({ items, hasUnread }: { items: NotificationRow[]; hasUnread: boolean }) {
  useEffect(() => {
    if (hasUnread) void markAllNotificationsReadAction();
  }, [hasUnread]);

  return (
    <ul className="flex flex-col divide-y divide-line rounded-lg border border-line bg-surface shadow-e1">
      {items.map((n) => {
        const content = (
          <>
            <span
              aria-hidden="true"
              className={`mt-1.5 size-2.5 shrink-0 rounded-full ${n.read ? "bg-transparent" : "bg-brand-600"}`}
            />
            <div className="flex min-w-0 flex-1 flex-col gap-0.5">
              <span className={`text-body-sm ${n.read ? "font-medium text-body" : "font-bold text-ink"}`}>
                {n.title}
                {!n.read && <span className="sr-only"> (جديد)</span>}
              </span>
              <span className="text-body-sm text-body">{n.body}</span>
              <span className="text-caption text-muted">{n.ago}</span>
            </div>
            {n.href && <ChevronIcon className="mt-1 shrink-0 text-muted" />}
          </>
        );
        return (
          <li key={n.id}>
            {n.href ? (
              <Link href={n.href} className="flex items-start gap-3 px-4 py-3.5">
                {content}
              </Link>
            ) : (
              <div className="flex items-start gap-3 px-4 py-3.5">{content}</div>
            )}
          </li>
        );
      })}
    </ul>
  );
}
