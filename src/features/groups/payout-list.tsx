import { formatDate } from "@/lib/dates";
import { formatAmount } from "@/lib/money";
import type { SlotRow } from "@/server/services/group-detail";

export function ownersSummary(slot: SlotRow): string {
  if (slot.owners.length === 0) return "لسه مش متقسم";
  if (slot.owners.length === 1) return slot.owners[0].name;
  return slot.owners.map((o) => `${o.name} ${formatAmount(o.amount)}`).join(" + ");
}

function Row({ slot, isCurrent, isPast }: { slot: SlotRow; isCurrent: boolean; isPast: boolean }) {
  const mine = slot.owners.some((o) => o.isMe);
  return (
    <li
      className={`flex min-h-[62px] items-center gap-3 rounded-[14px] border px-3 py-2 ${
        isCurrent ? "border-brand-200 bg-brand-50" : isPast ? "border-line bg-surface-2" : "border-line bg-surface"
      }`}
    >
      <span
        className={`flex size-[30px] shrink-0 items-center justify-center rounded-[9px] text-body-sm font-bold ${
          isCurrent ? "bg-brand-600 text-white" : isPast ? "bg-sunken text-muted" : "bg-surface-2 text-body"
        }`}
      >
        {slot.payoutOrder}
      </span>
      <div className="flex min-w-0 flex-1 flex-col gap-0.5">
        <div className="flex flex-wrap items-center gap-1.5">
          <span className={`text-body-sm font-semibold ${isPast ? "text-muted" : "text-ink"}`}>اسم {slot.slotNumber}</span>
          {isCurrent && (
            <span className="rounded-full bg-brand-600 px-2 text-[12.5px] leading-[22px] font-semibold text-white">
              الدورة دي
            </span>
          )}
          {mine && !isPast && (
            <span className="rounded-full border border-brand-100 bg-brand-50 px-2 text-[12.5px] leading-[22px] font-semibold text-brand-700">
              دورك
            </span>
          )}
        </div>
        <span className="text-caption text-muted">
          {ownersSummary(slot)}
          {slot.payoutDate && ` · ${formatDate(slot.payoutDate)}`}
        </span>
      </div>
    </li>
  );
}

/**
 * Read-only payout order (members and admins). Shares are visible to members by
 * decision (DATABASE.md §10); payment status never appears here.
 */
export function PayoutList({ slots, currentCycle }: { slots: SlotRow[]; currentCycle: number }) {
  const past = slots.filter((s) => s.payoutOrder < currentCycle);
  const rest = slots.filter((s) => s.payoutOrder >= currentCycle);

  return (
    <div className="flex flex-col gap-2">
      {past.length > 0 && (
        <details className="group rounded-[14px] border border-line bg-surface-2">
          <summary className="flex min-h-11 cursor-pointer items-center px-3 text-body-sm font-semibold text-muted">
            اللي فاتوا ({past.length})
          </summary>
          <ol className="flex flex-col gap-2 p-2 pt-0">
            {past.map((s) => (
              <Row key={s.id} slot={s} isCurrent={false} isPast />
            ))}
          </ol>
        </details>
      )}
      <ol className="flex flex-col gap-2">
        {rest.map((s) => (
          <Row key={s.id} slot={s} isCurrent={s.payoutOrder === currentCycle} isPast={false} />
        ))}
      </ol>
    </div>
  );
}
