"use client";

import { ChevronIcon, CoinsIcon } from "@/components/ui/icons";
import { SHOW_INSTALL_EVENT } from "./install-prompt";

/** Re-opens the "add to home screen" steps from the profile page. */
export function ShowInstallButton() {
  return (
    <button
      type="button"
      onClick={() => window.dispatchEvent(new Event(SHOW_INSTALL_EVENT))}
      className="flex min-h-14 w-full items-center gap-3 px-4 text-start"
    >
      <CoinsIcon className="text-muted" />
      <span className="flex-1 text-body-sm font-semibold text-ink">ضيف التطبيق على الشاشة الرئيسية</span>
      <ChevronIcon className="text-muted" />
    </button>
  );
}
