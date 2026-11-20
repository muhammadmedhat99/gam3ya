"use client";

import { Button, Input, Label, TextField } from "@heroui/react";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { BottomSheet } from "@/components/ui/bottom-sheet";
import { CloseIcon, PlusIcon } from "@/components/ui/icons";
import { Notice } from "@/components/ui/notice";
import { formatAmount, formatEGP, fromPiasters, parseAmountInput, toPiasters } from "@/lib/money";
import { setSlotAllocationsAction } from "@/server/actions/group-setup";
import type { SlotRow } from "@/server/services/group-detail";

interface Row {
  memberId: string;
  name: string;
  amount: string;
}

/** Design "15 · تعديل تقسيم اسم (شيت)". Save is enabled only when the total is exact. */
export function EditSplitSheet({
  groupId,
  slot,
  slotAmount,
  members,
  onClose,
}: {
  groupId: string;
  slot: SlotRow;
  slotAmount: string;
  members: { id: string; name: string }[];
  onClose: () => void;
}) {
  const router = useRouter();
  const [rows, setRows] = useState<Row[]>(
    slot.owners.map((o) => ({ memberId: o.memberId, name: o.name, amount: formatAmount(o.amount).replace(/,/g, "") })),
  );
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  const target = toPiasters(slotAmount);
  const allValid = rows.every((r) => {
    const a = parseAmountInput(r.amount);
    return a !== null && toPiasters(a) > 0n;
  });
  const allocated = rows.reduce((acc, r) => acc + toPiasters(r.amount), 0n);
  const remaining = target - allocated;
  const canSave = rows.length === 0 ? slot.owners.length > 0 : allValid && remaining === 0n;
  const available = members.filter((m) => !rows.some((r) => r.memberId === m.id));

  function setAmount(i: number, amount: string) {
    setRows((rs) => rs.map((r, j) => (j === i ? { ...r, amount } : r)));
  }

  function fillRemaining() {
    if (remaining <= 0n || rows.length === 0) return;
    // Give the remainder to the first owner without an amount, else to the last one.
    const emptyIdx = rows.findIndex((r) => !parseAmountInput(r.amount));
    const idx = emptyIdx === -1 ? rows.length - 1 : emptyIdx;
    setAmount(idx, fromPiasters(toPiasters(rows[idx].amount) + remaining).replace(/\.00$/, ""));
  }

  async function save() {
    setSaving(true);
    setError(null);
    const result = await setSlotAllocationsAction({
      groupId,
      slotId: slot.id,
      allocations: rows.map((r) => ({ memberId: r.memberId, amount: r.amount })),
    });
    setSaving(false);
    if ("ok" in result) {
      onClose();
      router.refresh();
    } else {
      setError(result.error ?? "راجع المبالغ وجرب تاني.");
    }
  }

  const tone =
    remaining === 0n
      ? "border-brand-100 bg-brand-50 text-brand-700"
      : remaining > 0n
        ? "border-warning-line bg-warning-soft text-warning"
        : "border-danger-line bg-danger-soft text-danger";
  const pct = target > 0n ? Math.min(100, Number((allocated * 1000n) / target) / 10) : 0;

  return (
    <BottomSheet
      isOpen
      onOpenChange={(open) => !open && onClose()}
      title={`تقسيم اسم ${slot.slotNumber}`}
      subtitle={`قيمة الاسم ${formatEGP(slotAmount)}`}
      footer={
        <>
          <Button size="lg" fullWidth isDisabled={!canSave} isPending={saving} onPress={save}>
            احفظ
          </Button>
          {!canSave && (
            <p className="text-center text-caption text-muted">
              الحفظ بيشتغل لما المجموع يبقى {formatEGP(slotAmount)} بالظبط
            </p>
          )}
        </>
      }
    >
      {error && <Notice title={error} />}

      <div aria-live="polite" className={`flex flex-col gap-2 rounded-[14px] border px-4 py-3.5 ${tone}`}>
        <div className="flex flex-wrap items-center justify-between gap-2">
          <p className="text-label">{remaining < 0n ? "زيادة" : "الباقي"}</p>
          <p className="tabular">
            <span className="text-[1.5rem] leading-8 font-bold">
              {formatAmount(fromPiasters(remaining < 0n ? -remaining : remaining))}
            </span>{" "}
            <span className="text-[0.9375rem] font-medium">ج.م</span>
          </p>
        </div>
        <div
          role="progressbar"
          aria-valuemin={0}
          aria-valuemax={100}
          aria-valuenow={Math.round(pct)}
          aria-label="اتوزع من الاسم"
          className="h-2 overflow-hidden rounded-full bg-sunken"
        >
          <div className="h-full rounded-full bg-brand-600" style={{ width: `${pct}%` }} />
        </div>
        <p className="tabular text-caption text-body">
          اتوزع {formatAmount(fromPiasters(allocated))} من {formatEGP(slotAmount)}
        </p>
      </div>

      <div className="flex flex-col gap-3">
        <p className="text-label text-ink">أصحاب الاسم</p>
        {rows.length === 0 && <p className="text-body-sm text-muted">الاسم ده لسه ملوش أصحاب.</p>}
        {rows.map((row, i) => (
          <div key={row.memberId} className="flex items-center gap-2.5">
            <span className="flex size-9 shrink-0 items-center justify-center rounded-full bg-surface-2 text-[0.9375rem] font-bold text-body">
              {row.name.charAt(0)}
            </span>
            <TextField
              value={row.amount}
              onChange={(v) => setAmount(i, v)}
              className="flex min-w-0 flex-1 items-center gap-2.5"
              aria-label={`حصة ${row.name}`}
            >
              <Label className="min-w-0 flex-1 truncate">{row.name}</Label>
              <div className="input-group flex h-12! w-35 shrink-0 items-center">
                <Input
                  dir="ltr"
                  inputMode="decimal"
                  placeholder="0"
                  className="input-group__input min-w-0 flex-1 border-0 bg-transparent text-right outline-none"
                />
                <span className="text-[0.9375rem] font-medium text-muted">ج.م</span>
              </div>
            </TextField>
            <Button
              variant="ghost"
              isIconOnly
              aria-label={`شيل ${row.name} من الاسم`}
              onPress={() => setRows((rs) => rs.filter((_, j) => j !== i))}
              className="text-muted"
            >
              <CloseIcon />
            </Button>
          </div>
        ))}

        <div className="flex flex-wrap gap-2">
          {remaining > 0n && rows.length > 0 && (
            <Button variant="outline" onPress={fillRemaining} className="rounded-full">
              حط الباقي: {formatEGP(fromPiasters(remaining))}
            </Button>
          )}
        </div>

        {available.length > 0 ? (
          <label className="flex flex-col gap-1.5">
            <span className="text-label text-ink">ضيف صاحب تاني</span>
            <span className="relative flex items-center">
              <PlusIcon className="pointer-events-none absolute inset-s-3.5 text-brand-700" />
              <select
                value=""
                onChange={(e) => {
                  const m = members.find((x) => x.id === e.target.value);
                  if (m) setRows((rs) => [...rs, { memberId: m.id, name: m.name, amount: "" }]);
                }}
                className="h-12 w-full appearance-none rounded-[12px] border-[1.5px] border-line-strong bg-surface ps-11 pe-4 text-[0.9375rem] font-semibold text-brand-700"
              >
                <option value="">اختار عضو…</option>
                {available.map((m) => (
                  <option key={m.id} value={m.id}>
                    {m.name}
                  </option>
                ))}
              </select>
            </span>
          </label>
        ) : (
          members.length === 0 && (
            <Notice tone="warning" title="مفيش أعضاء لسه">
              ضيف الأعضاء الأول من تاب الأعضاء، وبعدين قسّم الأسامي عليهم.
            </Notice>
          )
        )}
      </div>
    </BottomSheet>
  );
}
