"use client";

import { Button } from "@heroui/react";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { BottomSheet } from "@/components/ui/bottom-sheet";
import { CheckIcon, UserIcon } from "@/components/ui/icons";
import { Notice } from "@/components/ui/notice";
import { EmptyState } from "@/components/ui/states";
import { formatEgyptPhone } from "@/lib/phone";
import { reviewLinkRequestAction } from "@/server/actions/group-setup";

export interface LinkRequestItem {
  id: string;
  registeredName: string;
  phone: string;
  memberName: string;
  ago: string;
}

/** Design "13 · طلبات الربط" + "تأكيد الموافقة" + فاضية. */
export function LinkRequestsView({
  groupId,
  groupName,
  requests,
}: {
  groupId: string;
  groupName: string;
  requests: LinkRequestItem[];
}) {
  const router = useRouter();
  const [confirming, setConfirming] = useState<{ request: LinkRequestItem; approve: boolean } | null>(null);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function review() {
    if (!confirming) return;
    setPending(true);
    setError(null);
    const result = await reviewLinkRequestAction({
      groupId,
      requestId: confirming.request.id,
      approve: confirming.approve,
    });
    setPending(false);
    if ("ok" in result) {
      setConfirming(null);
      router.refresh();
    } else {
      setError(result.error ?? "حصلت مشكلة. جرب تاني.");
    }
  }

  if (requests.length === 0) {
    return (
      <main className="px-4 pt-4">
        <EmptyState
          icon={<UserIcon size={30} />}
          title="مفيش طلبات ربط"
          description="لما حد يسجّل برقم إنت ضايفه في الجمعية، هيظهر هنا عشان توافق عليه."
        />
      </main>
    );
  }

  return (
    <main className="flex flex-col gap-3 px-4 pt-4 pb-6">
      <p className="text-body-sm text-muted">
        دول ناس سجّلوا بأرقام إنت ضايفها. اتأكد إن ده نفس الشخص قبل ما توافق، وبعدها هيشوف الجمعية.
      </p>
      {error && !confirming && <Notice title={error} />}

      {requests.map((r) => (
        <section key={r.id} className="flex flex-col gap-3 rounded-lg border border-line bg-surface p-4 shadow-e1">
          <div className="flex flex-wrap items-center gap-3">
            <div className="flex min-w-[min(13rem,100%)] flex-1 items-center gap-3">
              <span className="flex size-10 shrink-0 items-center justify-center rounded-full bg-brand-50 text-title-3 text-brand-700">
                {r.registeredName.charAt(0)}
              </span>
              <div className="flex min-w-0 flex-1 flex-col">
                <span className="text-body-sm font-semibold text-ink">{r.registeredName}</span>
                <span dir="ltr" className="tabular text-right text-caption text-muted">
                  {formatEgyptPhone(r.phone)}
                </span>
              </div>
            </div>
            <span className="shrink-0 text-caption text-muted">{r.ago}</span>
          </div>
          <dl className="grid grid-cols-[repeat(auto-fit,minmax(min(8rem,100%),1fr))] gap-2 rounded-[12px] bg-surface-2 p-3 text-body-sm">
            <div>
              <dt className="text-caption text-muted">إنت كتبته</dt>
              <dd className="font-semibold text-ink">{r.memberName}</dd>
            </div>
            <div>
              <dt className="text-caption text-muted">هو سجّل بيه</dt>
              <dd className="font-semibold text-ink">{r.registeredName}</dd>
            </div>
          </dl>
          <p className="flex items-center gap-1.5 text-caption text-brand-700">
            <CheckIcon size={16} />
            رقم الموبايل مطابق للي إنت ضايفه
          </p>
          <div className="flex gap-2.5">
            <Button variant="outline" className="flex-1" onPress={() => setConfirming({ request: r, approve: false })}>
              رفض
            </Button>
            <Button className="flex-[2]" onPress={() => setConfirming({ request: r, approve: true })}>
              وافق
            </Button>
          </div>
        </section>
      ))}

      {confirming && (
        <BottomSheet
          isOpen
          onOpenChange={(open) => !open && !pending && setConfirming(null)}
          title={
            confirming.approve
              ? `توافق على ربط ${confirming.request.registeredName}؟`
              : `ترفض طلب ${confirming.request.registeredName}؟`
          }
          footer={
            <>
              <Button
                size="lg"
                fullWidth
                variant={confirming.approve ? "primary" : "danger"}
                isPending={pending}
                onPress={review}
              >
                {confirming.approve ? "أيوه، وافق" : "أيوه، ارفض"}
              </Button>
              <Button variant="ghost" fullWidth isDisabled={pending} onPress={() => setConfirming(null)}>
                ارجع
              </Button>
            </>
          }
        >
          {error && <Notice title={error} />}
          <p className="text-body text-body">
            {confirming.approve
              ? `هتظهر له ${groupName} باسم «${confirming.request.memberName}»: الأعضاء وترتيب القبض ونصيبه. مش هيشوف أي حاجة عن مين دفع ومين لأ.`
              : `مش هيشوف ${groupName}، وهيفضل «${confirming.request.memberName}» في الجمعية من غير حساب مربوط.`}
          </p>
        </BottomSheet>
      )}
    </main>
  );
}
