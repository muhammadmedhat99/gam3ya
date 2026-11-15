"use client";

import { Button, Label, TextArea, TextField } from "@heroui/react";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { BottomSheet } from "@/components/ui/bottom-sheet";
import { InfoIcon } from "@/components/ui/icons";
import { Notice } from "@/components/ui/notice";
import { formatDate, todayInCairo } from "@/lib/dates";
import { formatAmount, formatEGP, fromPiasters, parseAmountInput, toPiasters } from "@/lib/money";
import { recordPayoutAction, reversePayoutAction } from "@/server/actions/payouts";
import type { PayoutEntry, PayoutOwner } from "@/server/services/payouts";

const METHOD = { cash: "كاش", transfer: "تحويل" } as const;

function Segmented({ value, onChange }: { value: "cash" | "transfer"; onChange: (v: "cash" | "transfer") => void }) {
  return (
    <fieldset className="flex flex-col gap-1.5">
      <legend className="mb-1.5 text-label text-ink">اتسلّم إزاي؟</legend>
      <div className="flex gap-1 rounded-[14px] bg-sunken p-1">
        {(["cash", "transfer"] as const).map((m) => (
          <label
            key={m}
            className={`flex h-11 flex-1 cursor-pointer items-center justify-center rounded-[10px] text-[15px] has-focus-visible:ring-2 has-focus-visible:ring-brand-600 ${
              value === m ? "bg-surface font-bold text-ink shadow-e1" : "font-medium text-muted"
            }`}
          >
            <input type="radio" name="method" checked={value === m} onChange={() => onChange(m)} className="sr-only" />
            {METHOD[m]}
          </label>
        ))}
      </div>
    </fieldset>
  );
}

/** Record money handed to one owner of the slot whose turn it is (partial allowed). */
export function RecordPayoutSheet({
  groupId,
  cycleId,
  cycleNumber,
  owner,
  shortfall,
  onClose,
}: {
  groupId: string;
  cycleId: string;
  cycleNumber: number;
  owner: PayoutOwner;
  /** pot − collected, when collection isn't complete yet. */
  shortfall: string | null;
  onClose: () => void;
}) {
  const router = useRouter();
  const [amount, setAmount] = useState(formatAmount(owner.remaining).replace(/,/g, ""));
  const [paidOn, setPaidOn] = useState(todayInCairo());
  const [method, setMethod] = useState<"cash" | "transfer">("cash");
  const [note, setNote] = useState("");
  const [idempotencyKey] = useState(() => crypto.randomUUID());
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);

  const parsed = parseAmountInput(amount);
  const left = toPiasters(owner.remaining) - (parsed ? toPiasters(parsed) : 0n);

  async function submit() {
    setPending(true);
    setError(null);
    const result = await recordPayoutAction({
      groupId,
      cycleId,
      memberId: owner.memberId,
      amount,
      paidOn,
      method,
      note,
      idempotencyKey,
    });
    setPending(false);
    if ("ok" in result) {
      onClose();
      router.refresh();
    } else {
      setError(result.error ?? Object.values(result.fieldErrors ?? {})[0] ?? "حصلت مشكلة. جرب تاني.");
    }
  }

  return (
    <BottomSheet
      isOpen
      onOpenChange={(open) => !open && !pending && onClose()}
      title="سجّل القبض"
      subtitle={`${owner.name} · الدورة ${cycleNumber}`}
      footer={
        <Button size="lg" fullWidth isDisabled={!parsed || left < 0n} isPending={pending} onPress={submit}>
          {parsed ? `سجّل ${formatEGP(parsed)}` : "سجّل"}
        </Button>
      }
    >
      {error && <Notice title={error} />}
      {shortfall && (
        <Notice tone="warning" title="لسه التحصيل مخلصش">
          فاضل {formatEGP(shortfall)} متحصّلوش في الدورة دي. تقدر تسجّل القبض عادي لو سلّمت الفلوس فعلًا.
        </Notice>
      )}

      <div className="grid grid-cols-3 gap-3 rounded-[14px] bg-surface-2 p-4">
        {[
          ["نصيبه", owner.expected],
          ["استلم", owner.received],
          ["الباقي له", owner.remaining],
        ].map(([label, value]) => (
          <div key={label} className="flex flex-col gap-0.5">
            <span className="text-caption text-muted">{label}</span>
            <span className="tabular text-amount-sm text-ink">{formatEGP(value)}</span>
          </div>
        ))}
      </div>

      <label className="flex flex-col gap-1.5">
        <span className="text-label text-ink">المبلغ اللي اتسلّم</span>
        <span className="input-group flex items-center">
          <input
            dir="ltr"
            inputMode="decimal"
            value={amount}
            onChange={(e) => setAmount(e.target.value)}
            className="input-group__input min-w-0 flex-1 border-0 bg-transparent text-right outline-none"
          />
          <span className="text-[15px] font-medium text-muted">ج.م</span>
        </span>
      </label>
      {parsed && (
        <p aria-live="polite" className={`text-body-sm ${left < 0n ? "font-semibold text-danger" : "text-muted"}`}>
          {left < 0n
            ? "المبلغ أكبر من الباقي له"
            : left === 0n
              ? "بعد التسجيل: استلم نصيبه كله"
              : `بعد التسجيل هيفضل له ${formatEGP(fromPiasters(left))}`}
        </p>
      )}

      <label className="flex flex-col gap-1.5">
        <span className="text-label text-ink">التاريخ</span>
        <input
          type="date"
          value={paidOn}
          max={todayInCairo()}
          onChange={(e) => setPaidOn(e.target.value)}
          className="h-13 rounded-[12px] border-[1.5px] border-line-strong bg-surface px-3.5 text-base text-ink"
        />
      </label>
      <Segmented value={method} onChange={setMethod} />
      <TextField value={note} onChange={setNote} className="flex flex-col gap-1.5">
        <Label>ملاحظة (اختياري)</Label>
        <TextArea rows={2} className="rounded-[12px] border-[1.5px] border-line-strong bg-surface px-3.5 py-3 text-base" />
      </TextField>
    </BottomSheet>
  );
}

/** Reversal entry for a recorded payout; the original stays visible. */
export function ReversePayoutSheet({
  groupId,
  entry,
  ownerName,
  onClose,
}: {
  groupId: string;
  entry: PayoutEntry;
  ownerName: string;
  onClose: () => void;
}) {
  const router = useRouter();
  const [reason, setReason] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);

  async function submit() {
    setPending(true);
    setError(null);
    const result = await reversePayoutAction({ groupId, disbursementId: entry.id, reason });
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
      title="تصحيح قبض"
      subtitle={ownerName}
      footer={
        <>
          <Button size="lg" fullWidth variant="danger" isDisabled={reason.trim().length < 3} isPending={pending} onPress={submit}>
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
        <span className="text-body-sm text-body">
          {formatDate(entry.paidOn)}
          {entry.method && ` · ${METHOD[entry.method]}`}
        </span>
        <span className="tabular text-amount-md text-ink">{formatEGP(entry.amount)}</span>
      </div>
      <Notice tone="accent" title="التصحيح مش بيمسح حاجة" icon={<InfoIcon />}>
        هيتسجل قيد عكسي بـ −{formatEGP(entry.amount)}، والتسجيل الأصلي هيفضل ظاهر.
      </Notice>
      <TextField value={reason} onChange={setReason} isRequired className="flex flex-col gap-1.5">
        <Label>سبب التصحيح</Label>
        <TextArea
          rows={2}
          placeholder="مثلًا: اتسجل لحد غلط"
          className="rounded-[12px] border-[1.5px] border-line-strong bg-surface px-3.5 py-3 text-base"
        />
      </TextField>
    </BottomSheet>
  );
}
