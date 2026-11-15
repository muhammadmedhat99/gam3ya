import { formatAmount } from "@/lib/money";

const OWNER_COLORS = ["bg-owner-1", "bg-owner-2", "bg-owner-3"];

export function ownerColor(index: number): string {
  return OWNER_COLORS[index % OWNER_COLORS.length];
}

/**
 * Design "تقسيم اسم": one bar split by owner share, striped where unallocated.
 * Widths come from the amounts; display only (no money math beyond ratios).
 */
export function SplitBar({
  slotAmount,
  owners,
  height = "h-3",
}: {
  slotAmount: string;
  owners: { name: string; amount: string }[];
  height?: string;
}) {
  const total = Math.max(
    Number(slotAmount),
    owners.reduce((acc, o) => acc + Number(o.amount), 0),
  );
  const allocated = owners.reduce((acc, o) => acc + Number(o.amount), 0);
  const free = Math.max(0, Number(slotAmount) - allocated);

  return (
    <div
      role="img"
      aria-label={
        owners.length
          ? `تقسيم الاسم: ${owners.map((o) => `${o.name} ${formatAmount(o.amount)}`).join("، ")}`
          : "الاسم لسه مش متقسم"
      }
      className={`flex ${height} gap-0.5 overflow-hidden rounded-full`}
    >
      {owners.map((o, i) => (
        <div key={o.name + i} className={`h-full ${ownerColor(i)}`} style={{ width: `${(Number(o.amount) / total) * 100}%` }} />
      ))}
      {free > 0 && (
        <div
          className="h-full bg-[repeating-linear-gradient(135deg,var(--color-surface-2)_0_4px,var(--color-sunken)_4px_8px)]"
          style={{ width: `${(free / total) * 100}%` }}
        />
      )}
    </div>
  );
}
