"use client";

import { Button } from "@heroui/react";
import Link from "next/link";
import { useState } from "react";
import { ChevronIcon } from "@/components/ui/icons";
import { PAYMENT_STATUS, PaymentStatusChip } from "@/components/ui/payment-status";
import { EmptyState } from "@/components/ui/states";
import { formatEGP } from "@/lib/money";
import type { CollectionRow, PaymentStatus } from "@/server/services/collections";
import { RecordPaymentSheet } from "./record-payment-sheet";

type Filter = "all" | PaymentStatus;

const FILTERS: { key: Filter; label: string }[] = [
  { key: "all", label: "الكل" },
  { key: "overdue", label: "متأخر" },
  { key: "partially_paid", label: "دفع جزء" },
  { key: "unpaid", label: "لسه" },
  { key: "paid", label: "مدفوع" },
];

function Amount({ label, value, tone }: { label: string; value: string; tone?: string }) {
  return (
    <div className="flex flex-col">
      <span className="text-micro text-muted">{label}</span>
      <span className={`tabular text-amount-sm ${tone ?? "text-ink"}`}>{formatEGP(value)}</span>
    </div>
  );
}

/** Design "17 · التحصيل" rows + filters + the record-payment sheet. Admin/collector only. */
export function CollectionView({
  groupId,
  cycleNumber,
  rows,
  counts,
}: {
  groupId: string;
  cycleNumber: number;
  rows: CollectionRow[];
  counts: Record<PaymentStatus, number>;
}) {
  const [filter, setFilter] = useState<Filter>("all");
  const [recording, setRecording] = useState<CollectionRow | null>(null);
  const shown = filter === "all" ? rows : rows.filter((r) => r.status === filter);
  const count = (f: Filter) => (f === "all" ? rows.length : counts[f]);

  return (
    <>
      <div role="group" aria-label="فلتر الحالة" className="-mx-4 flex gap-2 overflow-x-auto px-4 [scrollbar-width:none]">
        {FILTERS.map((f) => (
          <button
            key={f.key}
            type="button"
            aria-pressed={filter === f.key}
            onClick={() => setFilter(f.key)}
            className={`flex h-11 shrink-0 items-center gap-1.5 rounded-full border-[1.5px] px-3.5 text-body-sm font-semibold ${
              filter === f.key ? "border-ink bg-ink text-white" : "border-line-strong bg-surface text-body"
            }`}
          >
            {f.key !== "all" && <span className={`size-2 rounded-full ${PAYMENT_STATUS[f.key].dot}`} />}
            {f.label}
            <span className={`rounded-full px-1.5 text-micro font-bold ${filter === f.key ? "bg-white/20" : "bg-surface-2"}`}>
              {count(f.key)}
            </span>
          </button>
        ))}
      </div>

      {shown.length === 0 ? (
        <EmptyState
          icon={<ChevronIcon size={30} />}
          title="مفيش حد في الحالة دي"
          description={
            filter === "unpaid" && counts.overdue > 0
              ? "كل اللي لسه مدفعوش عدّى عليهم آخر ميعاد، فهتلاقيهم في «متأخر»."
              : undefined
          }
          action={
            filter === "unpaid" && counts.overdue > 0 ? (
              <Button variant="outline" onPress={() => setFilter("overdue")}>
                اعرض المتأخرين
              </Button>
            ) : undefined
          }
        />
      ) : (
        <ul className="flex flex-col gap-2">
          {shown.map((row) => (
            <li key={row.obligationId} className="flex flex-col gap-3 rounded-lg border border-line bg-surface p-4 shadow-e1">
              <div className="flex items-center gap-3">
                <span className="flex size-10 shrink-0 items-center justify-center rounded-full bg-surface-2 text-title-3 text-body">
                  {row.name.charAt(0)}
                </span>
                <div className="flex min-w-0 flex-1 flex-col">
                  <span className="truncate text-body-sm font-semibold text-ink">{row.name}</span>
                  <span className="truncate text-caption text-muted">{row.breakdown}</span>
                </div>
                <PaymentStatusChip status={row.status} />
              </div>
              <div className="grid grid-cols-3 gap-2 rounded-[12px] bg-surface-2 px-3 py-2.5">
                <Amount label="مستحق" value={row.due} />
                <Amount label="اتدفع" value={row.paid} />
                <Amount
                  label="باقي"
                  value={row.outstanding}
                  tone={row.status === "overdue" ? "text-overdue" : row.status === "partially_paid" ? "text-partial" : undefined}
                />
              </div>
              <div className="flex gap-2">
                <Link
                  href={`/groups/${groupId}/collection/${row.memberId}`}
                  className="button button--ghost flex-1"
                >
                  السجل
                </Link>
                {row.status !== "paid" && (
                  <Button className="flex-[2]" onPress={() => setRecording(row)}>
                    سجّل دفعة
                  </Button>
                )}
              </div>
            </li>
          ))}
        </ul>
      )}

      {recording && (
        <RecordPaymentSheet
          groupId={groupId}
          cycleNumber={cycleNumber}
          row={recording}
          onClose={() => setRecording(null)}
        />
      )}
    </>
  );
}
