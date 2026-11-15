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
