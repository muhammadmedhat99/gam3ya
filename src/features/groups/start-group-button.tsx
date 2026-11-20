"use client";

import { Button } from "@heroui/react";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { BottomSheet } from "@/components/ui/bottom-sheet";
import { LockIcon } from "@/components/ui/icons";
import { Notice } from "@/components/ui/notice";
import { activateGroupAction } from "@/server/actions/group-setup";

/** "ابدأ الجمعية": confirmation sheet, then activate_group (cycles + dues snapshot). */
export function StartGroupButton({
  groupId,
  ready,
  summary,
}: {
  groupId: string;
  ready: boolean;
  summary: { cycles: string; firstDue: string; lastDue: string; pot: string; startPassed: boolean };
}) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function start() {
    setPending(true);
    setError(null);
    const result = await activateGroupAction({ groupId });
    setPending(false);
    if ("ok" in result) {
      setOpen(false);
      router.refresh();
    } else {
      setError(result.error ?? "حصلت مشكلة. جرب تاني.");
    }
  }

  return (
    <>
      <Button size="lg" fullWidth isDisabled={!ready} onPress={() => setOpen(true)}>
        ابدأ الجمعية
      </Button>
      {open && (
        <BottomSheet
          isOpen
          onOpenChange={(o) => !o && !pending && setOpen(false)}
          title="تبدأ الجمعية؟"
          footer={
            <>
              <Button size="lg" fullWidth isPending={pending} onPress={start}>
                أيوه، ابدأ
              </Button>
              <Button variant="ghost" fullWidth isDisabled={pending} onPress={() => setOpen(false)}>
                لسه
              </Button>
            </>
          }
        >
          {error && <Notice title={error} />}
          <dl className="flex flex-col rounded-[14px] bg-surface-2 px-4 py-1">
            {[
              ["عدد الدورات", summary.cycles],
              ["مجموع كل دورة", summary.pot],
              ["أول تحصيل", summary.firstDue],
              ["آخر تحصيل", summary.lastDue],
            ].map(([label, value]) => (
              <div key={label} className="flex flex-wrap items-center justify-between gap-3 border-b border-line py-2.5 last:border-b-0">
                <dt className="text-body-sm text-muted">{label}</dt>
                <dd className="tabular text-body-sm font-semibold text-ink">{value}</dd>
              </div>
            ))}
          </dl>
          {summary.startPassed && (
            <Notice tone="warning" title="أول دورة بدأت بالفعل">
              تاريخ البداية فات، فالدورات اللي فاتت هتتحسب من دلوقتي وهيبقى ليها مواعيد تحصيل عدّت.
            </Notice>
          )}
          <p className="flex items-start gap-2 text-body-sm text-body">
            <LockIcon className="mt-0.5 shrink-0 text-muted" />
            بعد البدء مش هتقدر تغيّر قيمة الاسم ولا تقسيم الأسامي ولا المواعيد. ترتيب الأدوار اللي لسه مجاتش
            هيفضل ينفع يتغير.
          </p>
        </BottomSheet>
      )}
    </>
  );
}
