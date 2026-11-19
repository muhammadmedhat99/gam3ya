"use client";

import { Button } from "@heroui/react";
import { useState } from "react";
import { BottomSheet } from "@/components/ui/bottom-sheet";
import { Notice } from "@/components/ui/notice";
import { deleteGroupAction } from "@/server/actions/group-settings";

/** Owner only; offered for draft or completed groups. Requires typing the group's name. */
export function DeleteGroup({
  groupId,
  groupName,
  status,
}: {
  groupId: string;
  groupName: string;
  status: "draft" | "completed";
}) {
  const [open, setOpen] = useState(false);
  const [typed, setTyped] = useState("");
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const matches = typed.trim() === groupName.trim();

  async function remove() {
    setPending(true);
    setError(null);
    // On success the action redirects to /groups.
    const result = await deleteGroupAction({ groupId, confirmName: typed });
    setPending(false);
    setError(result.error ?? result.fieldErrors?.confirmName ?? "حصلت مشكلة. جرب تاني.");
  }

  return (
    <section aria-labelledby="delete" className="flex flex-col gap-2 rounded-lg border border-danger-line p-4">
      <h2 id="delete" className="text-title-3 text-danger">
        مسح الجمعية
      </h2>
      <p className="text-body-sm text-muted">
        {status === "draft"
          ? "الجمعية لسه مبدأتش. لو مسحتها هتختفي من عندك ومن عند كل الأعضاء."
          : "الجمعية خلصت. لو مسحتها هتختفي من التطبيق لكل الأعضاء."}
      </p>
      <Button variant="danger-soft" onPress={() => setOpen(true)}>
        امسح الجمعية
      </Button>

      {open && (
        <BottomSheet
          isOpen
          onOpenChange={(o) => !o && !pending && (setOpen(false), setTyped(""), setError(null))}
          title="تمسح الجمعية؟"
          footer={
            <>
              <Button size="lg" fullWidth variant="danger" isDisabled={!matches} isPending={pending} onPress={remove}>
                امسحها
              </Button>
              <Button variant="ghost" fullWidth isDisabled={pending} onPress={() => setOpen(false)}>
                لأ، ارجع
              </Button>
            </>
          }
        >
          {error && <Notice title={error} />}
          <ul className="flex list-disc flex-col gap-1.5 ps-5 text-body-sm text-body">
            <li>الجمعية هتختفي من «جمعياتي» عند كل الأعضاء، وهيوصلهم إشعار إنها اتمسحت.</li>
            <li>مش هينفع حد يعدّل فيها أو يسجّل فيها حاجة تاني.</li>
            {status === "completed" && (
              <li>سجلات الدفع والقبض مش بتتمسح، بتفضل محفوظة عشان لو احتجنا نراجع حاجة.</li>
            )}
          </ul>
          <label className="flex flex-col gap-1.5">
            <span className="text-label text-ink">
              اكتب اسم الجمعية للتأكيد: <b>{groupName}</b>
            </span>
            <input
              value={typed}
              onChange={(e) => setTyped(e.target.value)}
              autoComplete="off"
              className="h-13 rounded-[12px] border-[1.5px] border-line-strong bg-surface px-3.5 text-base text-ink"
            />
          </label>
        </BottomSheet>
      )}
    </section>
  );
}
