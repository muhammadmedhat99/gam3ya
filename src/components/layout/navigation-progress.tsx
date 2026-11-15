"use client";

import { usePathname, useSearchParams } from "next/navigation";
import { useEffect, useState } from "react";

/**
 * Thin top progress bar for every in-app navigation started from a link.
 * It's derived from "the URL we were on when the user tapped" vs "the URL now",
 * so it disappears by itself as soon as the new page is shown.
 */
export function NavigationProgress() {
  const pathname = usePathname();
  const search = useSearchParams().toString();
  const current = search ? `${pathname}?${search}` : pathname;
  const [startedOn, setStartedOn] = useState<string | null>(null);

  useEffect(() => {
    function onClick(e: MouseEvent) {
      if (e.defaultPrevented || e.button !== 0 || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return;
      const anchor = (e.target as Element | null)?.closest?.("a[href]");
      if (!(anchor instanceof HTMLAnchorElement) || anchor.target === "_blank" || anchor.hasAttribute("download")) return;
      const url = new URL(anchor.href, window.location.href);
      if (url.origin !== window.location.origin) return;
      const next = url.pathname + url.search;
      const here = window.location.pathname + window.location.search;
      if (next !== here) setStartedOn(here);
    }
    document.addEventListener("click", onClick, true);
    return () => document.removeEventListener("click", onClick, true);
  }, []);

  // Still on the page where the tap happened → navigation pending.
  const pending = startedOn !== null && startedOn === current;

  return (
    <div
      aria-hidden="true"
      className={`pointer-events-none fixed inset-x-0 top-0 z-50 h-0.75 overflow-hidden transition-opacity duration-200 ${
        pending ? "opacity-100 delay-100" : "opacity-0"
      }`}
    >
      <div className="h-full w-1/3 animate-[link-pending_1s_ease-in-out_infinite] rounded-full bg-brand-600" />
    </div>
  );
}
