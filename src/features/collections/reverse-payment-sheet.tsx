"use client";

import { Button, Label, TextArea, TextField } from "@heroui/react";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { BottomSheet } from "@/components/ui/bottom-sheet";
import { InfoIcon } from "@/components/ui/icons";
import { Notice } from "@/components/ui/notice";
import { PaymentStatusChip } from "@/components/ui/payment-status";
import { formatDate, todayInCairo } from "@/lib/dates";
import { formatEGP, fromPiasters, toPiasters } from "@/lib/money";
import { reversePaymentAction } from "@/server/actions/payments";
import type { LedgerEntry, PaymentStatus } from "@/server/services/collections";

const METHOD = { cash: "كاش", transfer: "تحويل" } as const;

/** Design "19 · تصحيح دفعة (شيت)": a reversal entry, the original stays in the ledger. */
export function ReversePaymentSheet({
  groupId,
  payment,
  cycleNumber,
  outstanding,
  paid,
  dueOn,
  onClose,
}: {
  groupId: string;
  payment: LedgerEntry;
  cycleNumber: number;
  outstanding: string;
  paid: string;
  dueOn: string;
  onClose: () => void;
}) {
  const router = useRouter();
  const [reason, setReason] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);

  const after = fromPiasters(toPiasters(outstanding) + toPiasters(payment.amount));
  const paidAfter = toPiasters(paid) - toPiasters(payment.amount);
  const afterStatus: PaymentStatus =
    dueOn < todayInCairo() ? "overdue" : paidAfter > 0n ? "partially_paid" : "unpaid";

  async function submit() {
    setPending(true);
    setError(null);
    const result = await reversePaymentAction({ groupId, paymentId: payment.id, reason });
    setPending(false);
    if ("ok" in result) {
      onClose();
      router.refresh();
    } else {
      setError(result.error ?? result.fieldErrors?.reason ?? "حصلت مشكلة. جرب تاني.");
    }
  }

  return (
    <BottomSheet
      isOpen
      onOpenChange={(open) => !open && !pending && onClose()}
      title="تصحيح دفعة"
      footer={
        <>
          <Button
            size="lg"
            fullWidth
            variant="danger"
            isDisabled={reason.trim().length < 3}
            isPending={pending}
            onPress={submit}
          >
            اعمل التصحيح
          </Button>
          <Button variant="ghost" fullWidth isDisabled={pending} onPress={onClose}>
            ارجع
          </Button>
        </>
      }
    >
      {error && <Notice title={error} />}
      <div className="flex items-center justify-between gap-3 rounded-[14px] bg-surface-2 px-4 py-3">
        <div className="flex flex-col">
          <span className="text-caption text-muted">الدفعة الأصلية</span>
          <span className="text-body-sm text-body">
            {formatDate(payment.paidOn)}
            {payment.method && ` · ${METHOD[payment.method]}`} · الدورة {cycleNumber}
          </span>
        </div>
        <span className="tabular text-amount-md text-ink">{formatEGP(payment.amount)}</span>
      </div>

      <Notice tone="accent" title="التصحيح مش بيمسح حاجة" icon={<InfoIcon />}>
        هيتسجل قيد عكسي بـ −{formatEGP(payment.amount)}، والدفعة الأصلية هتفضل ظاهرة في السجل.
      </Notice>

      <TextField value={reason} onChange={setReason} isRequired className="flex flex-col gap-1.5">
        <Label>سبب التصحيح</Label>
        <TextArea
          rows={2}
          placeholder="مثلًا: اتسجلت مرتين بالغلط"
          className="rounded-[12px] border-[1.5px] border-line-strong bg-surface px-3.5 py-3 text-base"
        />
      </TextField>

      <div className="flex items-center justify-between gap-3 rounded-[14px] border border-line px-4 py-3">
        <span className="text-body-sm text-muted">بعد التصحيح:</span>
        <span className="flex items-center gap-2">
          <PaymentStatusChip status={afterStatus} />
          <span className="text-caption text-muted">باقي</span>
          <span className="tabular text-amount-sm text-ink">{formatEGP(after)}</span>
        </span>
      </div>
    </BottomSheet>
  );
}
