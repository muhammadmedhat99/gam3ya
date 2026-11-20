"use client";

import { zodResolver } from "@hookform/resolvers/zod";
import { Button } from "@heroui/react";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { useForm } from "react-hook-form";
import type { z } from "zod";
import { applyActionErrors } from "@/components/forms/apply-action-errors";
import { FormTextField } from "@/components/forms/form-text-field";
import { BottomSheet } from "@/components/ui/bottom-sheet";
import { InfoIcon, PhoneIcon } from "@/components/ui/icons";
import { Notice } from "@/components/ui/notice";
import { formatEgyptPhone } from "@/lib/phone";
import { addMemberSchema, type AddMemberInput } from "@/lib/validation/group-setup";
import { addMemberAction } from "@/server/actions/group-setup";

type Values = z.output<typeof addMemberSchema>;

/** Design "12 · ضيف عضو (شيت)" + "الرقم عليه حساب" confirmation. */
export function AddMemberSheet({
  groupId,
  isOpen,
  onOpenChange,
}: {
  groupId: string;
  isOpen: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const router = useRouter();
  const [formError, setFormError] = useState<string | null>(null);
  const [existing, setExisting] = useState<{ registeredName: string; values: Values } | null>(null);
  const [linking, setLinking] = useState(false);
  const { control, handleSubmit, setError, reset, formState } = useForm<AddMemberInput, unknown, Values>({
    resolver: zodResolver(addMemberSchema),
    defaultValues: { groupId, displayName: "", phone: "", confirmLink: false },
  });

  function close(open: boolean) {
    onOpenChange(open);
    if (!open) {
      reset();
      setExisting(null);
      setFormError(null);
    }
  }

  async function submit(values: Values) {
    setFormError(null);
    const result = await addMemberAction(values);
    if ("needsConfirmation" in result) {
      setExisting({ registeredName: result.needsConfirmation.registeredName, values });
      return;
    }
    if ("ok" in result) {
      close(false);
      router.refresh();
      return;
    }
    setExisting(null);
    setFormError(applyActionErrors(result, setError));
  }

  async function confirmLink() {
    if (!existing) return;
    setLinking(true);
    await submit({ ...existing.values, confirmLink: true });
    setLinking(false);
  }

  return (
    <BottomSheet
      isOpen={isOpen}
      onOpenChange={close}
      title="ضيف عضو"
      footer={
        existing ? (
          <>
            <Button size="lg" fullWidth isPending={linking} onPress={confirmLink}>
              أيوه، ضيفه واربطه
            </Button>
            <Button variant="ghost" fullWidth onPress={() => setExisting(null)}>
              لأ، هغيّر الرقم
            </Button>
          </>
        ) : (
          <Button size="lg" fullWidth isPending={formState.isSubmitting} onPress={() => handleSubmit(submit)()}>
            ضيف
          </Button>
        )
      }
    >
      <form
        noValidate
        onSubmit={(e) => {
          e.preventDefault();
          void handleSubmit(submit)();
        }}
        className="flex flex-col gap-4"
      >
        {formError && <Notice title={formError} />}
        <FormTextField
          control={control}
          name="displayName"
          label="الاسم"
          hint={{ text: "الاسم اللي الناس عارفينه بيه في الجمعية" }}
          isDisabled={Boolean(existing)}
        />
        <FormTextField
          control={control}
          name="phone"
          label="رقم الموبايل"
          type="tel"
          inputMode="tel"
          ltr
          placeholder="010 1234 5678"
          icon={<PhoneIcon />}
          isDisabled={Boolean(existing)}
        />

        {existing ? (
          <div className="flex flex-col gap-3 rounded-[14px] border border-brand-100 bg-brand-50 p-4">
            <p className="text-label text-brand-700">الرقم ده عليه حساب في التطبيق</p>
            <div className="flex items-center gap-3">
              <span className="flex size-10 shrink-0 items-center justify-center rounded-full bg-surface text-title-3 text-brand-700">
                {existing.registeredName.charAt(0)}
              </span>
              <div className="flex flex-col">
                <span className="text-body-sm font-semibold text-ink">{existing.registeredName}</span>
                <span dir="ltr" className="tabular text-right text-caption text-muted">
                  {formatEgyptPhone(existing.values.phone)}
                </span>
              </div>
            </div>
            <dl className="grid grid-cols-[repeat(auto-fit,minmax(min(8rem,100%),1fr))] gap-2 rounded-[12px] bg-surface p-3 text-body-sm">
              <div>
                <dt className="text-caption text-muted">إنت كتبت</dt>
                <dd className="font-semibold text-ink">{existing.values.displayName}</dd>
              </div>
              <div>
                <dt className="text-caption text-muted">متسجل باسم</dt>
                <dd className="font-semibold text-ink">{existing.registeredName}</dd>
              </div>
            </dl>
            <p className="text-body-sm text-body">
              ده نفس الشخص اللي بتضيفه؟ لو أيوه، هيتربط بحسابه وهيشوف الجمعية على طول.
            </p>
          </div>
        ) : (
          <Notice tone="accent" title="لو الرقم عليه حساب" icon={<InfoIcon />}>
            هنوريك الاسم اللي متسجل بيه عشان تتأكد إنه نفس الشخص. ولو مفيش، يقدر يسجّل بيه بعدين.
          </Notice>
        )}
        <button type="submit" hidden />
      </form>
    </BottomSheet>
  );
}
