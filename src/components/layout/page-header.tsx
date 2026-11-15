import Link from "next/link";
import type { ReactNode } from "react";
import { BackIcon } from "@/components/ui/icons";

/** Design "App bar": white, bottom border, title + subtitle, optional back link and actions. */
export function PageHeader({
  title,
  subtitle,
  backHref,
  backLabel = "رجوع",
  backIcon,
  actions,
}: {
  title: string;
  subtitle?: string;
  backHref?: string;
  backLabel?: string;
  backIcon?: ReactNode;
  actions?: ReactNode;
}) {
  return (
    <header className="sticky top-0 z-20 flex min-h-16 shrink-0 items-center gap-1 border-b border-line bg-surface p-2">
      {backHref && (
        <Link href={backHref} aria-label={backLabel} className="button button--ghost button--icon-only text-ink">
          {backIcon ?? <BackIcon size={22} />}
        </Link>
      )}
      <div className={`min-w-0 flex-1 ${backHref ? "" : "ps-2"}`}>
        <h1 className="truncate text-title-2 text-ink">{title}</h1>
        {subtitle && <p className="text-caption text-muted">{subtitle}</p>}
      </div>
      {actions}
    </header>
  );
}
