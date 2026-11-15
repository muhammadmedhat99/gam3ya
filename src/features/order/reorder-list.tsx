"use client";

import { Button } from "@heroui/react";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { LockIcon } from "@/components/ui/icons";
import { Notice } from "@/components/ui/notice";
import { formatDayMonth } from "@/lib/dates";
import { buildSchedule, type Frequency } from "@/lib/schedule";
import { reorderPayoutsAction } from "@/server/actions/group-setup";
import type { SlotRow } from "@/server/services/group-detail";
import { ownersSummary } from "@/features/groups/payout-list";

const ArrowUp = () => (
  <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
    <path d="M12 19V5M6 11l6-6 6 6" />
  </svg>
);
const ArrowDown = () => (
  <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
    <path d="M12 5v14M6 13l6 6 6-6" />
  </svg>
);

/**
 * Design "16 · ترتيب القبض". Turns that already happened and the current one are
 * locked; the rest move with up/down buttons (accessible, works on every phone).
 */
export function ReorderList({
  groupId,
  slots,
  currentCycle,
  schedule,
}: {
  groupId: string;
  slots: SlotRow[];
  currentCycle: number;
  schedule: { startDate: string; frequency: Frequency; dueDay: number };
}) {
  const router = useRouter();
  const initial = [...slots].sort((a, b) => a.payoutOrder - b.payoutOrder);
  const [order, setOrder] = useState(initial);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [announce, setAnnounce] = useState("");

  const dates = buildSchedule({ ...schedule, cycles: order.length });
  const lockedCount = currentCycle; // positions 1..currentCycle are fixed
  const dirty = order.some((s, i) => s.id !== initial[i].id);

  function move(index: number, delta: -1 | 1) {
    const target = index + delta;
    if (target < lockedCount || target >= order.length) return;
    const next = [...order];
    [next[index], next[target]] = [next[target], next[index]];
    setOrder(next);
    setAnnounce(`اسم ${next[target].slotNumber} بقى رقم ${target + 1}`);
  }

  async function save() {
    setSaving(true);
    setError(null);
    const result = await reorderPayoutsAction({ groupId, slotIds: order.map((s) => s.id) });
    setSaving(false);
    if ("ok" in result) router.refresh();
    else setError(result.error ?? "حصلت مشكلة. جرب تاني.");
  }

  return (
    <main className="flex flex-col gap-3 px-4 pt-4 pb-40">
      <p className="text-body-sm text-muted">
        رتّب مين يقبض الأول باستخدام الأسهم.
        {lockedCount > 0 && " الأدوار اللي فاتت والدورة الحالية متقفلة."}
      </p>
      {error && <Notice title={error} />}
      <p className="sr-only" aria-live="polite">
        {announce}
      </p>

      <ol className="flex flex-col gap-2">
        {order.map((slot, i) => {
          const locked = i < lockedCount;
          const isCurrent = i + 1 === currentCycle;
          const moved = slot.id !== initial[i].id;
          return (
            <li
              key={slot.id}
              className={`flex min-h-[62px] items-center gap-2 rounded-[14px] border p-2 ${
                locked
                  ? "border-line bg-surface-2"
                  : moved
                    ? "border-brand-200 bg-brand-50"
                    : "border-line bg-surface"
              }`}
            >
              {locked && (
                <span aria-label="متقفل" className="flex h-11 w-9 items-center justify-center text-muted">
                  <LockIcon />
                </span>
              )}
              <span
                className={`flex size-[30px] shrink-0 items-center justify-center rounded-[9px] text-body-sm font-bold ${
                  isCurrent
                    ? "bg-brand-600 text-white"
                    : locked
                      ? "bg-sunken text-muted"
                      : moved
                        ? "bg-brand-50 text-brand-700"
                        : "bg-surface-2 text-body"
                }`}
              >
                {i + 1}
              </span>
              <div className="flex min-w-0 flex-1 flex-col gap-0.5">
                <div className="flex flex-wrap items-center gap-1.5">
                  <span className={`text-body-sm font-semibold ${locked && !isCurrent ? "text-muted" : "text-ink"}`}>
                    اسم {slot.slotNumber}
                  </span>
                  {isCurrent && (
                    <span className="rounded-full bg-brand-600 px-2 text-[12.5px] leading-[22px] font-semibold text-white">
                      الدورة دي
                    </span>
                  )}
                  {moved && (
                    <span className="rounded-full border border-brand-100 bg-brand-50 px-2 text-[12.5px] leading-[22px] font-semibold text-brand-700">
                      اتنقل
                    </span>
                  )}
                </div>
                <span className="truncate text-caption text-muted">
                  {ownersSummary(slot)} · {formatDayMonth(dates[i].dueOn)}
                </span>
              </div>
              {!locked && (
                <div className="flex gap-1">
                  <Button
                    variant="ghost"
                    isIconOnly
                    aria-label={`طلّع اسم ${slot.slotNumber} لفوق`}
                    isDisabled={i <= lockedCount}
                    onPress={() => move(i, -1)}
                  >
                    <ArrowUp />
                  </Button>
                  <Button
                    variant="ghost"
                    isIconOnly
                    aria-label={`نزّل اسم ${slot.slotNumber} لتحت`}
                    isDisabled={i === order.length - 1}
                    onPress={() => move(i, 1)}
                  >
                    <ArrowDown />
                  </Button>
                </div>
              )}
            </li>
          );
        })}
      </ol>

      {dirty && (
        <div className="fixed inset-x-0 bottom-[88px] z-20 mx-auto flex max-w-md flex-col gap-2 border-t border-line bg-surface px-4 pt-3 pb-3 shadow-[0_-4px_16px_rgba(31,29,26,0.05)]">
          <p className="text-caption font-semibold text-warning">عندك تغييرات مش محفوظة</p>
          <div className="flex gap-2.5">
            <Button variant="outline" className="flex-1" onPress={() => setOrder(initial)}>
              تراجع
            </Button>
            <Button className="flex-[2]" isPending={saving} onPress={save}>
              احفظ الترتيب
            </Button>
          </div>
        </div>
      )}
    </main>
  );
}
