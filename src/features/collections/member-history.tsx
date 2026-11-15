"use client";

import { Button } from "@heroui/react";
import { useState } from "react";
import { PaymentStatusChip } from "@/components/ui/payment-status";
import { formatDate, formatMonthYear } from "@/lib/dates";
import { formatEGP } from "@/lib/money";
import type { LedgerEntry, MemberCycleHistory } from "@/server/services/collections";
import { ReversePaymentSheet } from "./reverse-payment-sheet";

const METHOD = { cash: "كاش", transfer: "تحويل" } as const;

function Entry({ entry, canReverse, onReverse }: { entry: LedgerEntry; canReverse: boolean; onReverse: () => void }) {
  if (entry.kind === "reversal") {
    return (
      <li className="flex items-start gap-3 rounded-[12px] border border-overdue-line bg-overdue-soft px-3 py-2.5">
        <div className="flex min-w-0 flex-1 flex-col gap-0.5">
          <span className="text-body-sm font-semibold text-overdue">قيد عكسي</span>
          <span className="text-caption text-body">
            {formatDate(entry.paidOn)} · {entry.note}
          </span>
          <span className="text-caption text-muted">
            {entry.reversesPaidOn ? `بيلغي دفعة ${formatDate(entry.reversesPaidOn)}` : "بيلغي دفعة"} · سجّله{" "}
            {entry.recordedBy}
          </span>
        </div>
        <span className="tabular shrink-0 text-amount-sm text-overdue">−{formatEGP(entry.amount)}</span>
      </li>
    );
  }
  return (
    <li className="flex items-center gap-3 rounded-[12px] border border-line bg-surface px-3 py-2.5">
      <div className="flex min-w-0 flex-1 flex-col gap-0.5">
        <span className="flex items-center gap-1.5 text-body-sm font-semibold text-ink">
          دفعة
          {entry.reversed && (
            <span className="rounded-full border border-line-strong px-2 text-micro text-muted">عليها تصحيح</span>
          )}
        </span>
        <span className="text-caption text-muted">
          {formatDate(entry.paidOn)}
          {entry.method && ` · ${METHOD[entry.method]}`}
          {entry.note && ` · ${entry.note}`}
        </span>
      </div>
      <span className={`tabular shrink-0 text-amount-sm ${entry.reversed ? "text-muted line-through" : "text-ink"}`}>
        {formatEGP(entry.amount)}
      </span>
      {canReverse && !entry.reversed && (
        <Button variant="ghost" size="sm" onPress={onReverse}>
          تصحيح
        </Button>
      )}
    </li>
  );
}

/** Design "19 · سجل مدفوعات عضو": every cycle, payments and reversals (never deleted). */
export function MemberHistory({
  groupId,
  cycles,
  canReverse,
}: {
  groupId: string;
  cycles: MemberCycleHistory[];
  canReverse: boolean;
}) {
  const [reversing, setReversing] = useState<{ entry: LedgerEntry; cycle: MemberCycleHistory } | null>(null);

  return (
    <>
      {cycles.map((cycle) => (
        <section key={cycle.obligationId} className="flex flex-col gap-2.5 rounded-lg border border-line bg-surface p-4 shadow-e1">
          <div className="flex items-center gap-2">
            <h3 className="flex-1 text-title-3 text-ink">
              الدورة {cycle.cycleNumber} · <span className="font-normal text-muted">{formatMonthYear(cycle.dueOn)}</span>
            </h3>
            <PaymentStatusChip status={cycle.status} />
          </div>
          <p className="tabular text-body-sm text-muted">
            <span className="font-semibold text-ink">{formatEGP(cycle.paid)}</span> من {formatEGP(cycle.due)}
            {cycle.status !== "paid" && ` · باقي ${formatEGP(cycle.outstanding)}`}
          </p>
          {cycle.entries.length === 0 ? (
            <p className="text-caption text-muted">مفيش دفعات متسجلة.</p>
          ) : (
            <ul className="flex flex-col gap-2">
              {cycle.entries.map((entry) => (
                <Entry
                  key={entry.id}
                  entry={entry}
                  canReverse={canReverse}
                  onReverse={() => setReversing({ entry, cycle })}
                />
              ))}
            </ul>
          )}
        </section>
      ))}

      {reversing && (
        <ReversePaymentSheet
          groupId={groupId}
          payment={reversing.entry}
          cycleNumber={reversing.cycle.cycleNumber}
          outstanding={reversing.cycle.outstanding}
          paid={reversing.cycle.paid}
          dueOn={reversing.cycle.dueOn}
          onClose={() => setReversing(null)}
        />
      )}
    </>
  );
}
