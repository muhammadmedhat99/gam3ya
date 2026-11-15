"use client";

import { useLinkStatus } from "next/link";

/**
 * Instant feedback inside a <Link> while its navigation is pending
 * (must be rendered as a descendant of the Link).
 */
export function LinkPendingBar({ className = "" }: { className?: string }) {
  const { pending } = useLinkStatus();
  return (
    <span
      aria-hidden="true"
      className={`pointer-events-none absolute overflow-hidden rounded-full transition-opacity ${
        pending ? "opacity-100" : "opacity-0"
      } ${className}`}
    >
      <span className="block h-full w-1/2 animate-[link-pending_0.9s_ease-in-out_infinite] rounded-full bg-brand-600" />
    </span>
  );
}
