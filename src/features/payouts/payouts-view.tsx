"use client";

import { Button } from "@heroui/react";
import { useState } from "react";
import { CheckIcon, DotIcon } from "@/components/ui/icons";
import { Notice } from "@/components/ui/notice";
import { formatDate } from "@/lib/dates";
import { formatEGP, fromPiasters, toPiasters } from "@/lib/money";
import type { CyclePayout, PayoutEntry, PayoutOwner, PayoutStatus } from "@/server/services/payouts";
import { RecordPayoutSheet, ReversePayoutSheet } from "./payout-sheets";

const STATUS: Record<PayoutStatus, { label: string; cls: string; icon: React.ReactNode }> = {
  pending: { label: "لسه مقبضش", cls: "border-unpaid-line bg-unpaid-soft text-unpaid", icon: <DotIcon size={14} /> },
  partially_paid: { label: "قبض جزء", cls: "border-partial-line bg-partial-soft text-partial", icon: <DotIcon size={14} /> },
  paid: { label: "قبض", cls: "border-paid-line bg-paid-soft text-paid", icon: <CheckIcon size={14} /> },
};

const METHOD = { cash: "كاش", transfer: "تحويل" } as const;

export function PayoutStatusChip({ status }: { status: PayoutStatus }) {
  const s = STATUS[status];
  return (
    <span className={`inline-flex min-h-7 py-0.5 shrink-0 items-center gap-1 rounded-full border px-2.5 text-caption font-semibold ${s.cls}`}>
      {s.icon}
      {s.label}
    </span>
  );
}

/** Owners of the slot whose turn it is, with their entitlement and the payout ledger. Admin only. */
export function PayoutsView({ groupId, data }: { groupId: string; data: CyclePayout }) {
  const [recording, setRecording] = useState<PayoutOwner | null>(null);
  const [reversing, setReversing] = useState<{ entry: PayoutEntry; owner: PayoutOwner } | null>(null);

  const shortfallP = toPiasters(data.pot) - toPiasters(data.collected);
  const shortfall = shortfallP > 0n ? fromPiasters(shortfallP) : null;

  if (!data.started) {
    return (
      <Notice tone="accent" title={`الدورة ${data.cycle.number} لسه مبدأتش`}>
        تقدر تسجّل القبض من {formatDate(data.cycle.startsOn)}.
      </Notice>
    );
  }

  return (
    <>
      {data.owners.map((owner) => (
        <section key={owner.memberId} className="flex flex-col gap-3 rounded-lg border border-line bg-surface p-4 shadow-e1">
          <div className="flex flex-wrap items-center gap-3">
            <div className="flex min-w-[min(13rem,100%)] flex-1 items-center gap-3">
              <span className="flex size-10 shrink-0 items-center justify-center rounded-full bg-brand-50 text-title-3 text-brand-700">
                {owner.name.charAt(0)}
              </span>
              <div className="flex min-w-0 flex-1 flex-col">
                <span className="text-body-sm font-semibold text-ink">{owner.name}</span>
                <span className="tabular text-caption text-muted">حصته في الاسم {formatEGP(owner.share)}</span>
              </div>
            </div>
            <PayoutStatusChip status={owner.status} />
          </div>
          <div className="grid grid-cols-[repeat(auto-fit,minmax(min(5.5rem,100%),1fr))] gap-2 rounded-[12px] bg-surface-2 px-3 py-2.5">
            {[
              ["نصيبه", owner.expected],
              ["استلم", owner.received],
              ["الباقي له", owner.remaining],
            ].map(([label, value]) => (
              <div key={label} className="flex flex-col">
                <span className="text-micro text-muted">{label}</span>
                <span className="tabular text-amount-sm text-ink">{formatEGP(value)}</span>
              </div>
            ))}
          </div>

          {owner.entries.length > 0 && (
            <ul className="flex flex-col gap-2">
              {owner.entries.map((e) =>
                e.kind === "reversal" ? (
                  <li key={e.id} className="flex flex-wrap items-start gap-x-3 gap-y-1 rounded-[12px] border border-overdue-line bg-overdue-soft px-3 py-2">
                    <div className="flex min-w-[min(9rem,100%)] flex-1 flex-col">
                      <span className="text-body-sm font-semibold text-overdue">قيد عكسي</span>
                      <span className="text-caption text-body">
                        {formatDate(e.paidOn)} · {e.note} · سجّله {e.recordedBy}
                      </span>
                    </div>
                    <span className="tabular text-amount-sm text-overdue">−{formatEGP(e.amount)}</span>
                  </li>
                ) : (
                  <li key={e.id} className="flex flex-wrap items-center gap-x-3 gap-y-1 rounded-[12px] border border-line px-3 py-2">
                    <div className="flex min-w-[min(9rem,100%)] flex-1 flex-col">
                      <span className="flex items-center gap-1.5 text-body-sm font-semibold text-ink">
                        استلم
                        {e.reversed && (
                          <span className="rounded-full border border-line-strong px-2 text-micro text-muted">عليه تصحيح</span>
                        )}
                      </span>
                      <span className="text-caption text-muted">
                        {formatDate(e.paidOn)}
                        {e.method && ` · ${METHOD[e.method]}`}
                        {e.note && ` · ${e.note}`}
                      </span>
                    </div>
                    <span className={`tabular text-amount-sm ${e.reversed ? "text-muted line-through" : "text-ink"}`}>
                      {formatEGP(e.amount)}
                    </span>
                    {!e.reversed && (
                      <Button variant="ghost" size="sm" onPress={() => setReversing({ entry: e, owner })}>
                        تصحيح
                      </Button>
                    )}
                  </li>
                ),
              )}
            </ul>
          )}

          {owner.status !== "paid" && (
            <Button fullWidth onPress={() => setRecording(owner)}>
              سجّل القبض
            </Button>
          )}
        </section>
      ))}

      {recording && (
        <RecordPayoutSheet
          groupId={groupId}
          cycleId={data.cycle.id}
          cycleNumber={data.cycle.number}
          owner={recording}
          shortfall={shortfall}
          onClose={() => setRecording(null)}
        />
      )}
      {reversing && (
        <ReversePayoutSheet
          groupId={groupId}
          entry={reversing.entry}
          ownerName={reversing.owner.name}
          onClose={() => setReversing(null)}
        />
      )}
    </>
  );
}
