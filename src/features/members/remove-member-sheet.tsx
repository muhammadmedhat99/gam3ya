"use client";

import { Button } from "@heroui/react";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { BottomSheet } from "@/components/ui/bottom-sheet";
import { InfoIcon } from "@/components/ui/icons";
import { Notice } from "@/components/ui/notice";
import { slotsLabel } from "@/lib/arabic";
import { formatEGP, multiplyAmount } from "@/lib/money";
import { removeMemberAction } from "@/server/actions/group-setup";
import type { MemberRow } from "@/server/services/group-detail";

type Mode = "replace" | "shrink";

/**
 * Remove a member. Draft: shares become "ناقص" (or go to a replacement).
 * Started: only if they paid nothing and their turn hasn't come; then either a
 * replacement takes their place, or the group shrinks by their names.
 */
export function RemoveMemberSheet({
  groupId,
  member,
  others,
  isDraft,
  slotCount,
  slotAmount,
  onClose,
}: {
  groupId: string;
  member: MemberRow;
  others: { id: string; name: string }[];
  isDraft: boolean;
  slotCount: number;
  slotAmount: string;
  onClose: () => void;
}) {
  const router = useRouter();
  const r = member.removal!;
  const blocked = !isDraft && (r.hasPaid || r.turnCame);
  const remaining = slotCount - r.ownedNames;
  const canShrink = !isDraft && !r.sharesAName && remaining >= 2;
  const [mode, setMode] = useState<Mode>(canShrink ? "shrink" : "replace");
  const [replacementId, setReplacementId] = useState("");
  const [reason, setReason] = useState("");
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const needsReplacement = !isDraft && mode === "replace";
  const ready = !blocked && (!needsReplacement || replacementId !== "");

  async function submit() {
    setPending(true);
    setError(null);
    const result = await removeMemberAction({
      groupId,
      memberId: member.id,
      replacementId: (isDraft || mode === "replace") && replacementId ? replacementId : null,
      reason,
    });
    setPending(false);
    if ("ok" in result) {
      onClose();
      router.refresh();
    } else setError(result.error ?? "حصلت مشكلة. جرب تاني.");
  }

  const names = member.slotNumbers.map((n) => `اسم ${n}`).join(" و");

  return (
    <BottomSheet
      isOpen
      onOpenChange={(o) => !o && !pending && onClose()}
      title={`تشيل ${member.displayName}؟`}
      footer={
        blocked ? (
          <Button size="lg" fullWidth onPress={onClose}>
            تمام
          </Button>
        ) : (
          <>
            <Button size="lg" fullWidth variant="danger" isDisabled={!ready} isPending={pending} onPress={submit}>
              شيله من الجمعية
            </Button>
            <Button variant="ghost" fullWidth isDisabled={pending} onPress={onClose}>
              لأ، ارجع
            </Button>
          </>
        )
      }
    >
      {error && <Notice title={error} />}

      {blocked ? (
        <Notice tone="warning" title="مينفعش يتشال">
          {r.hasPaid
            ? "العضو ده دفع قسط أو أكتر. بعد ما الجمعية تبدأ، اللي دفع مينفعش يتشال."
            : "دور العضو ده في القبض جه خلاص، فمينفعش يتشال."}
        </Notice>
      ) : isDraft ? (
        <>
          <p className="text-body text-body">
            {member.slotNumbers.length
              ? `هيتشال من الجمعية، و${names} هترجع ناقصة تقسّمها من جديد. أو اختار حد ياخد حصته.`
              : "هيتشال من الجمعية. مالوش حصص في أي اسم."}
          </p>
          {member.slotNumbers.length > 0 && (
            <ReplacementSelect others={others} value={replacementId} onChange={setReplacementId} optional />
          )}
        </>
      ) : (
        <>
          <p className="text-body-sm text-muted">
            الجمعية بدأت، بس {member.displayName} مادفعش ولا قسط ودوره لسه مجاش. اختار تعمل إيه:
          </p>
          <fieldset className="flex flex-col gap-2">
            <legend className="sr-only">طريقة الشيل</legend>
            <ModeOption
              checked={mode === "shrink"}
              disabled={!canShrink}
              onChange={() => setMode("shrink")}
              title="الجمعية تقل"
              body={
                !canShrink
                  ? r.sharesAName
                    ? "مينفعش: هو شريك في اسم مع حد، فلازم حد يدخل مكانه."
                    : "مينفعش: الجمعية لازم يفضل فيها اسمين على الأقل."
                  : r.ownedNames
                    ? `${names} هتتشال، واللي بعده هيطلعوا دور لقدام. الجمعية هتبقى ${slotsLabel(remaining)}، ومجموع كل دورة ${formatEGP(multiplyAmount(slotAmount, remaining))}.`
                    : "هيتشال من غير ما الأسامي تتغير، لأنه مالوش حصص."
              }
            />
            <ModeOption
              checked={mode === "replace"}
              onChange={() => setMode("replace")}
              title="حد يدخل مكانه"
              body="البديل بياخد حصصه ومستحقاته في كل الدورات، ويدفع ويقبض مكانه. الترتيب بيفضل زي ما هو."
            />
          </fieldset>
          {mode === "replace" && <ReplacementSelect others={others} value={replacementId} onChange={setReplacementId} />}
          <Notice tone="accent" title="مفيش حاجة بتتمسح" icon={<InfoIcon />}>
            مستحقاته القديمة بتفضل في السجل، وبيتسجل قيد تسوية بيلغيها
            {mode === "replace" ? " ويحطها على البديل" : ""}.
          </Notice>
        </>
      )}

      {!blocked && (
        <label className="flex flex-col gap-1.5">
          <span className="text-label text-ink">السبب (اختياري)</span>
          <input
            value={reason}
            onChange={(e) => setReason(e.target.value)}
            className="h-13 rounded-[12px] border-[1.5px] border-line-strong bg-surface px-3.5 text-base text-ink"
          />
        </label>
      )}
    </BottomSheet>
  );
}

function ModeOption({
  checked,
  disabled,
  onChange,
  title,
  body,
}: {
  checked: boolean;
  disabled?: boolean;
  onChange: () => void;
  title: string;
  body: string;
}) {
  return (
    <label
      className={`flex items-start gap-3 rounded-[14px] border-[1.5px] p-3.5 has-focus-visible:ring-2 has-focus-visible:ring-brand-600 ${
        disabled
          ? "cursor-not-allowed border-line bg-surface-2 opacity-70"
          : checked
            ? "cursor-pointer border-brand-600 bg-brand-50"
            : "cursor-pointer border-line-strong bg-surface"
      }`}
    >
      <input
        type="radio"
        name="remove-mode"
        checked={checked}
        disabled={disabled}
        onChange={onChange}
        className="mt-1 size-4 accent-brand-600"
      />
      <span className="flex flex-col">
        <span className="text-body-sm font-semibold text-ink">{title}</span>
        <span className="text-caption text-muted">{body}</span>
      </span>
    </label>
  );
}

function ReplacementSelect({
  others,
  value,
  onChange,
  optional,
}: {
  others: { id: string; name: string }[];
  value: string;
  onChange: (v: string) => void;
  optional?: boolean;
}) {
  return (
    <label className="flex flex-col gap-1.5">
      <span className="text-label text-ink">{optional ? "يدخل مكانه (اختياري)" : "مين يدخل مكانه؟"}</span>
      <select
        value={value}
        onChange={(e) => onChange(e.target.value)}
        className="h-13 rounded-[12px] border-[1.5px] border-line-strong bg-surface px-3.5 text-base text-ink"
      >
        <option value="">{optional ? "محدش، سيب أساميه ناقصة" : "اختار عضو…"}</option>
        {others.map((o) => (
          <option key={o.id} value={o.id}>
            {o.name}
          </option>
        ))}
      </select>
      {others.length === 0 && (
        <span className="text-caption text-muted">ضيف العضو الجديد الأول من «ضيف عضو»، وبعدين اختاره هنا.</span>
      )}
    </label>
  );
}
