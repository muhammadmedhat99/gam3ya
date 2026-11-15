import type { ReactNode } from "react";

/** Design "فاضي / خطأ": icon in a soft circle, title, one sentence, optional action. */
export function EmptyState({
  icon,
  title,
  description,
  action,
  tone = "brand",
}: {
  icon: ReactNode;
  title: string;
  description?: string;
  action?: ReactNode;
  tone?: "brand" | "danger";
}) {
  return (
    <div className="flex flex-col items-center gap-3 px-6 py-10 text-center">
      <span
        className={`flex size-16 items-center justify-center rounded-full ${
          tone === "danger" ? "bg-danger-soft text-danger" : "bg-brand-50 text-brand-700"
        }`}
      >
        {icon}
      </span>
      <div className="flex flex-col gap-1">
        <p className="text-title-3 text-ink">{title}</p>
        {description && <p className="text-body-sm text-muted">{description}</p>}
      </div>
      {action}
    </div>
  );
}

export function Skeleton({ className }: { className: string }) {
  return <span aria-hidden="true" className={`block animate-pulse rounded-md bg-sunken ${className}`} />;
}

export function CardSkeleton() {
  return (
    <div className="flex flex-col gap-3 rounded-lg border border-line bg-surface p-4 shadow-e1">
      <Skeleton className="h-5 w-2/5" />
      <Skeleton className="h-4 w-3/5" />
      <div className="flex gap-1.5">
        <Skeleton className="h-[26px] w-16 rounded-full" />
        <Skeleton className="h-[26px] w-16 rounded-full" />
      </div>
      <Skeleton className="h-1.5 w-full rounded-full" />
    </div>
  );
}

/**
 * Route-level loading fallback (loading.tsx): appears instantly on navigation
 * while the server renders the real page.
 */
export function PageSkeleton({
  header = true,
  cards = 3,
  hero = false,
}: {
  header?: boolean;
  cards?: number;
  hero?: boolean;
}) {
  return (
    <div aria-busy="true" aria-live="polite" className="flex flex-col">
      <span className="sr-only">بيحمّل…</span>
      {header && (
        <div className="flex min-h-16 items-center gap-3 border-b border-line bg-surface px-4">
          <Skeleton className="h-5 w-36" />
        </div>
      )}
      <div className="flex flex-col gap-3 px-4 pt-4">
        {hero && <Skeleton className="h-28 w-full rounded-lg" />}
        {Array.from({ length: cards }, (_, i) => (
          <CardSkeleton key={i} />
        ))}
      </div>
    </div>
  );
}

/** Progress bar from the design (6px, sunken track, brand fill). */
export function Progress({ value, max, label }: { value: number; max: number; label: string }) {
  const pct = max > 0 ? Math.min(100, (value / max) * 100) : 0;
  return (
    <div
      role="progressbar"
      aria-valuemin={0}
      aria-valuemax={max}
      aria-valuenow={value}
      aria-label={label}
      className="h-1.5 overflow-hidden rounded-full bg-sunken"
    >
      <div className="h-full rounded-full bg-brand-600" style={{ width: `${pct}%` }} />
    </div>
  );
}
