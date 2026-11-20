"use client";

import { zodResolver } from "@hookform/resolvers/zod";
import { Button, Label, TextArea, TextField } from "@heroui/react";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { Controller, useForm, useWatch } from "react-hook-form";
import type { z } from "zod";
import { applyActionErrors } from "@/components/forms/apply-action-errors";
import { FormTextField } from "@/components/forms/form-text-field";
import { BottomSheet } from "@/components/ui/bottom-sheet";
import { CalendarIcon } from "@/components/ui/icons";
import { Notice } from "@/components/ui/notice";
import { PaymentStatusChip } from "@/components/ui/payment-status";
import { todayInCairo } from "@/lib/dates";
import { formatAmount, formatEGP, fromPiasters, parseAmountInput, toPiasters } from "@/lib/money";
import { recordPaymentSchema, type RecordPaymentInput } from "@/lib/validation/payments";
import { recordPaymentAction } from "@/server/actions/payments";
import type { CollectionRow } from "@/server/services/collections";

type Values = z.output<typeof recordPaymentSchema>;

function Stat({ label, value, strong }: { label: string; value: string; strong?: boolean }) {
  return (
    <div className="flex flex-col gap-0.5">
      <span className="text-caption text-muted">{label}</span>
      <span className={`tabular ${strong ? "text-amount-md text-ink" : "text-amount-sm text-body"}`}>{value}</span>
    </div>
  );
}

/** Design "18 · سجّل دفعة (شيت)". Partial payments allowed; never more than what's left. */
export function RecordPaymentSheet({
  groupId,
  cycleNumber,
  row,
  onClose,
}: {
  groupId: string;
  cycleNumber: number;
  row: CollectionRow;
  onClose: () => void;
}) {
  const router = useRouter();
  const [formError, setFormError] = useState<string | null>(null);
  const [idempotencyKey] = useState(() => crypto.randomUUID());
  const { control, handleSubmit, setValue, setError, formState } = useForm<RecordPaymentInput, unknown, Values>({
    resolver: zodResolver(recordPaymentSchema),
    defaultValues: {
      groupId,
      obligationId: row.obligationId,
      amount: formatAmount(row.outstanding).replace(/,/g, ""),
      paidOn: todayInCairo(),
      method: "cash",
      note: "",
      idempotencyKey,
    },
  });

  const amountInput = useWatch({ control, name: "amount" }) ?? "";
  const amount = parseAmountInput(amountInput);
  const left = toPiasters(row.outstanding) - (amount ? toPiasters(amount) : 0n);
  const tooMuch = left < 0n;

  async function submit(values: Values) {
    setFormError(null);
    const result = await recordPaymentAction(values);
    if ("ok" in result) {
      onClose();
      router.refresh();
    } else {
      setFormError(applyActionErrors(result, setError));
    }
  }

  return (
    <BottomSheet
      isOpen
      onOpenChange={(open) => !open && onClose()}
      title="سجّل دفعة"
      subtitle={`${row.name} · الدورة ${cycleNumber}`}
      footer={
        <Button
          size="lg"
          fullWidth
          isDisabled={!amount || tooMuch}
          isPending={formState.isSubmitting}
          onPress={() => handleSubmit(submit)()}
        >
          {amount ? `سجّل ${formatEGP(amount)}` : "سجّل"}
        </Button>
      }
    >
      {formError && <Notice title={formError} />}

      <div className="grid grid-cols-[repeat(auto-fit,minmax(min(5.5rem,100%),1fr))] gap-3 rounded-[14px] bg-surface-2 p-4">
        <Stat label="المستحق" value={formatEGP(row.due)} />
        <Stat label="اتدفع قبل كده" value={formatEGP(row.paid)} />
        <Stat label="الباقي" value={formatEGP(row.outstanding)} strong />
      </div>

      <form
        noValidate
        onSubmit={(e) => {
          e.preventDefault();
          void handleSubmit(submit)();
        }}
        className="flex flex-col gap-4"
      >
        <FormTextField
          control={control}
          name="amount"
          label="المبلغ اللي اتدفع"
          ltr
          inputMode="decimal"
          suffix="ج.م"
        />
        <Button
          variant="outline"
          className="-mt-2 self-start rounded-full"
          onPress={() => setValue("amount", formatAmount(row.outstanding).replace(/,/g, ""), { shouldValidate: true })}
        >
          الباقي كله: {formatEGP(row.outstanding)}
        </Button>

        {amount && (
          <div
            aria-live="polite"
            className="flex flex-wrap items-center justify-between gap-3 rounded-[14px] border border-line px-4 py-3"
          >
            <span className="text-body-sm text-muted">بعد التسجيل:</span>
            {tooMuch ? (
              <span className="text-body-sm font-semibold text-danger">المبلغ أكبر من الباقي</span>
            ) : left === 0n ? (
              <PaymentStatusChip status="paid" />
            ) : (
              <span className="flex items-center gap-2">
                <PaymentStatusChip status={row.status === "overdue" ? "overdue" : "partially_paid"} />
                <span className="text-caption text-muted">هيفضل باقي</span>
                <span className="tabular text-amount-sm text-ink">{formatEGP(fromPiasters(left))}</span>
              </span>
            )}
          </div>
        )}

        <FormTextField control={control} name="paidOn" label="التاريخ" type="date" icon={<CalendarIcon />} />

        <Controller
          control={control}
          name="method"
          render={({ field }) => (
            <fieldset className="flex flex-col gap-1.5">
              <legend className="mb-1.5 text-label text-ink">اتدفع إزاي؟</legend>
              <div className="flex gap-1 rounded-[14px] bg-sunken p-1">
                {(
                  [
                    ["cash", "كاش"],
                    ["transfer", "تحويل"],
                  ] as const
                ).map(([value, label]) => (
                  <label
                    key={value}
                    className={`flex min-h-11 py-1.5 flex-1 cursor-pointer items-center justify-center rounded-[10px] text-[0.9375rem] has-focus-visible:ring-2 has-focus-visible:ring-brand-600 ${
                      field.value === value ? "bg-surface font-bold text-ink shadow-e1" : "font-medium text-muted"
                    }`}
                  >
                    <input
                      type="radio"
                      name={field.name}
                      value={value}
                      checked={field.value === value}
                      onChange={() => field.onChange(value)}
                      className="sr-only"
                    />
                    {label}
                  </label>
                ))}
              </div>
            </fieldset>
          )}
        />

        <Controller
          control={control}
          name="note"
          render={({ field }) => (
            <TextField value={field.value ?? ""} onChange={field.onChange} className="flex flex-col gap-1.5">
              <Label>ملاحظة (اختياري)</Label>
              <TextArea
                rows={2}
                className="rounded-[12px] border-[1.5px] border-line-strong bg-surface px-3.5 py-3 text-base"
              />
            </TextField>
          )}
        />
        <button type="submit" hidden />
      </form>
    </BottomSheet>
  );
}
