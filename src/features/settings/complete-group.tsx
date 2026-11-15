"use client";

import { Button } from "@heroui/react";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { BottomSheet } from "@/components/ui/bottom-sheet";
import { Notice } from "@/components/ui/notice";
import { completeGroupAction } from "@/server/actions/group-settings";

/** Manual close. (The group also closes by itself when the last payout is fully handed over.) */
export function CompleteGroup({ groupId, canComplete }: { groupId: string; canComplete: boolean }) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function complete() {
    setPending(true);
    setError(null);
    const result = await completeGroupAction({ groupId });
    setPending(false);
    if ("ok" in result) {
      setOpen(false);
      router.refresh();
    } else setError(result.error ?? "حصلت مشكلة.");
  }

  return (
    <section aria-labelledby="close" className="flex flex-col gap-2">
      <h2 id="close" className="text-title-3 text-ink">
        إقفال الجمعية
      </h2>
      <p className="text-body-sm text-muted">
        الجمعية بتتقفل لوحدها أول ما آخر اسم يقبض نصيبه كامل. وتقدر تقفلها بنفسك بعد ما آخر دورة تبدأ.
      </p>
      <Button variant="outline" isDisabled={!canComplete} onPress={() => setOpen(true)}>
        اقفل الجمعية
      </Button>
      {!canComplete && <p className="text-caption text-muted">الزرار بيشتغل لما آخر دورة تبدأ.</p>}

      {open && (
        <BottomSheet
          isOpen
          onOpenChange={(o) => !o && !pending && setOpen(false)}
          title="تقفل الجمعية؟"
          footer={
            <>
              <Button size="lg" fullWidth isPending={pending} onPress={complete}>
                أيوه، اقفلها
              </Button>
              <Button variant="ghost" fullWidth isDisabled={pending} onPress={() => setOpen(false)}>
                لسه
              </Button>
            </>
          }
        >
          {error && <Notice title={error} />}
          <p className="text-body text-body">
            الجمعية هتتعلّم إنها خلصت. هتفضل تقدر تسجّل أي دفعات متأخرة أو قبض لسه متسجلش.
          </p>
        </BottomSheet>
      )}
    </section>
  );
}
