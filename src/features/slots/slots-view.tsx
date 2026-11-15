"use client";

import { Button } from "@heroui/react";
import { useState } from "react";
import { AlertCircleIcon, CheckIcon, PencilIcon } from "@/components/ui/icons";
import { Notice } from "@/components/ui/notice";
import { formatAmount, formatEGP } from "@/lib/money";
import type { SlotRow } from "@/server/services/group-detail";
import { ownerColor, SplitBar } from "@/features/groups/split-bar";
import { EditSplitSheet } from "./edit-split-sheet";

const FILL_CHIP = {
  full: { label: "كامل", cls: "border-brand-100 bg-brand-50 text-brand-700", icon: <CheckIcon size={14} /> },
  short: { label: "ناقص", cls: "border-warning-line bg-warning-soft text-warning", icon: <AlertCircleIcon size={14} /> },
  over: { label: "زيادة", cls: "border-danger-line bg-danger-soft text-danger", icon: <AlertCircleIcon size={14} /> },
} as const;

function SlotCard({
  slot,
  slotAmount,
  editable,
  onEdit,
}: {
  slot: SlotRow;
  slotAmount: string;
  editable: boolean;
  onEdit: () => void;
}) {
  const chip = FILL_CHIP[slot.fill];
  const diff = formatEGP(slot.remaining.replace("-", ""));
  return (
    <section className="flex flex-col gap-2.5 rounded-lg border border-line bg-surface p-3.5 shadow-e1">
      <div className="flex items-center gap-2">
        <h3 className="text-title-3 text-ink">اسم {slot.slotNumber}</h3>
        <span className={`inline-flex h-[26px] items-center gap-1 rounded-full border px-[9px] text-[12.5px] font-semibold ${chip.cls}`}>
          {chip.icon}
          {chip.label}
        </span>
        <span className="flex-1" />
        {editable && (
          <Button variant="ghost" isIconOnly aria-label={`عدّل تقسيم اسم ${slot.slotNumber}`} onPress={onEdit}>
            <PencilIcon />
          </Button>
        )}
      </div>
      <SplitBar slotAmount={slotAmount} owners={slot.owners} />
      <div className="flex flex-wrap items-center justify-between gap-x-4 gap-y-1.5">
        <div className="flex flex-wrap gap-x-4 gap-y-1">
          {slot.owners.length === 0 && <span className="text-caption text-muted">لسه ملوش أصحاب</span>}
          {slot.owners.map((o, i) => (
            <span key={o.memberId} className="flex items-center gap-1.5 text-caption">
              <span className={`size-2.5 rounded-[3px] ${ownerColor(i)}`} />
              <span className="font-medium text-body">{o.name}</span>
              <span className="tabular font-semibold text-ink">{formatAmount(o.amount)}</span>
              <span className="text-micro text-muted">ج.م</span>
            </span>
          ))}
        </div>
        {slot.fill !== "full" && (
          <span className={`text-caption font-bold ${slot.fill === "short" ? "text-warning" : "text-danger"}`}>
            {slot.fill === "short" ? `ناقص ${diff}` : `زيادة ${diff}`}
          </span>
        )}
      </div>
    </section>
  );
}

/** Design "14 · الأسامي والتقسيم": slots needing attention first, then complete ones. */
export function SlotsView({
  groupId,
  slots,
  slotAmount,
  members,
  editable,
}: {
  groupId: string;
  slots: SlotRow[];
  slotAmount: string;
  members: { id: string; name: string }[];
  editable: boolean;
}) {
  const [editing, setEditing] = useState<SlotRow | null>(null);
  const bySlot = [...slots].sort((a, b) => a.slotNumber - b.slotNumber);
  const needsWork = bySlot.filter((s) => s.fill !== "full");
  const complete = bySlot.filter((s) => s.fill === "full");

  return (
    <main className="flex flex-col gap-3 px-4 pt-4 pb-6">
      {needsWork.length > 0 && (
        <Notice tone="warning" title={`${needsWork.length === 1 ? "اسم واحد محتاج" : `${needsWork.length} أسامي محتاجين`} تظبيط`}>
          لازم كل اسم يبقى {formatEGP(slotAmount)} بالظبط قبل ما تبدأ الجمعية.
        </Notice>
      )}
      {!editable && (
        <Notice tone="accent" title="التقسيم اتقفل">
          الجمعية بدأت، فتقسيم الأسامي مبقاش ينفع يتغير.
        </Notice>
      )}

      {needsWork.length > 0 && (
        <>
          <h2 className="flex items-center gap-2 text-label text-ink">
            محتاج تظبيط
            <span className="rounded-full border border-warning-line bg-warning-soft px-2 text-[12.5px] font-semibold text-warning">
              {needsWork.length}
            </span>
          </h2>
          {needsWork.map((s) => (
            <SlotCard key={s.id} slot={s} slotAmount={slotAmount} editable={editable} onEdit={() => setEditing(s)} />
          ))}
        </>
      )}

      {complete.length > 0 && (
        <>
          <h2 className="flex items-center gap-2 text-label text-ink">
            كاملين
            <span className="rounded-full border border-brand-100 bg-brand-50 px-2 text-[12.5px] font-semibold text-brand-700">
              {complete.length}
            </span>
          </h2>
          {complete.map((s) => (
            <SlotCard key={s.id} slot={s} slotAmount={slotAmount} editable={editable} onEdit={() => setEditing(s)} />
          ))}
        </>
      )}

      {editing && (
        <EditSplitSheet
          groupId={groupId}
          slot={editing}
          slotAmount={slotAmount}
          members={members}
          onClose={() => setEditing(null)}
        />
      )}
    </main>
  );
}
