"use client";

import { zodResolver } from "@hookform/resolvers/zod";
import { Button } from "@heroui/react";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { useForm, useWatch } from "react-hook-form";
import { applyActionErrors } from "@/components/forms/apply-action-errors";
import { FormTextField } from "@/components/forms/form-text-field";
import { CalendarIcon, LockIcon } from "@/components/ui/icons";
import { Notice } from "@/components/ui/notice";
import { formatAmount } from "@/lib/money";
import type { Frequency } from "@/lib/schedule";
import { createGroupSchema, type CreateGroupInput, type CreateGroupValues } from "@/lib/validation/groups";
import { updateGroupSettingsAction } from "@/server/actions/group-settings";
import { DueDayField, FrequencyField, SlotCountField } from "@/features/groups/create-group-wizard";

export interface GroupSettingsValues {
  name: string;
  slotAmount: string;
  slotCount: number;
  frequency: Frequency;
  startDate: string;
  dueDay: number;
}

/** Name always; amount, slot count and schedule only while the group is a draft. */
export function SettingsForm({
  groupId,
  initial,
  isDraft,
}: {
  groupId: string;
  initial: GroupSettingsValues;
  isDraft: boolean;
}) {
  const router = useRouter();
  const [formError, setFormError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);
  const { control, handleSubmit, setValue, setError, formState } = useForm<
    CreateGroupInput,
    unknown,
    CreateGroupValues
  >({
    resolver: zodResolver(createGroupSchema),
    defaultValues: { ...initial, slotAmount: formatAmount(initial.slotAmount).replace(/,/g, "") },
  });
  const frequency = useWatch({ control, name: "frequency" });

  const onSubmit = handleSubmit(async (values) => {
    setFormError(null);
    setSaved(false);
    const result = await updateGroupSettingsAction({ ...values, groupId });
    if ("ok" in result) {
      setSaved(true);
      router.refresh();
    } else {
      setFormError(applyActionErrors(result, setError));
    }
  });

  return (
    <form onSubmit={onSubmit} noValidate className="flex flex-col gap-4">
      {formError && <Notice title={formError} />}
      {saved && (
        <Notice tone="accent" title="اتحفظ">
          التعديلات اتسجلت.
        </Notice>
      )}
      <FormTextField control={control} name="name" label="اسم الجمعية" />

      {isDraft ? (
        <>
          <FormTextField
            control={control}
            name="slotAmount"
            label="قيمة الاسم"
            ltr
            inputMode="decimal"
            suffix="ج.م"
            hint={{ text: "لو غيّرتها، الأسامي المتقسمة هتحتاج تتظبط تاني" }}
          />
          <SlotCountField control={control} />
          <FrequencyField
            control={control}
            onChange={(f) => setValue("dueDay", f === "monthly" ? 5 : 0, { shouldValidate: true })}
          />
          <FormTextField control={control} name="startDate" label="أول دورة" type="date" icon={<CalendarIcon />} />
          <DueDayField control={control} frequency={frequency ?? initial.frequency} />
        </>
      ) : (
        <p className="flex items-start gap-2 text-body-sm text-muted">
          <LockIcon className="mt-0.5 shrink-0" />
          قيمة الاسم وعدد الأسامي والمواعيد اتقفلت بعد ما الجمعية بدأت.
        </p>
      )}

      <Button type="submit" size="lg" fullWidth isPending={formState.isSubmitting}>
        احفظ
      </Button>
    </form>
  );
}
