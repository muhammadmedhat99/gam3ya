"use client";

import { zodResolver } from "@hookform/resolvers/zod";
import { Button, FieldError, Input, Label, TextField } from "@heroui/react";
import { useState } from "react";
import { Controller, useForm, useWatch, type Control } from "react-hook-form";
import { applyActionErrors } from "@/components/forms/apply-action-errors";
import { FormTextField } from "@/components/forms/form-text-field";
import { CalendarIcon, InfoIcon, MinusIcon, PlusIcon } from "@/components/ui/icons";
import { Notice } from "@/components/ui/notice";
import { cyclesLabel, frequencyLabel, monthsLabel, slotsLabel } from "@/lib/arabic";
import { formatDate } from "@/lib/dates";
import { formatEGP, multiplyAmount, parseAmountInput } from "@/lib/money";
import { buildSchedule, SEMI_MONTHLY_DAYS } from "@/lib/schedule";
import {
  createGroupSchema,
  type CreateGroupInput,
  type CreateGroupValues,
} from "@/lib/validation/groups";
import { createGroupAction } from "@/server/actions/groups";

const STEPS = ["الأساسيات", "المواعيد", "المراجعة"] as const;
const STEP_FIELDS: (keyof CreateGroupInput)[][] = [
  ["name", "slotAmount", "slotCount"],
  ["frequency", "startDate", "dueDay"],
  [],
];

function StepsBar({ step }: { step: number }) {
  return (
    <ol aria-label="خطوات إنشاء الجمعية" className="flex gap-2">
      {STEPS.map((label, i) => (
        <li key={label} aria-current={i === step ? "step" : undefined} className="flex flex-1 flex-col gap-1.5">
          <span className={`h-1.5 rounded-full ${i <= step ? "bg-brand-600" : "bg-sunken"}`} />
          <span
            className={`text-micro ${
              i === step ? "font-bold text-brand-700" : i < step ? "text-brand-700" : "text-muted"
            }`}
          >
            {i + 1}. {label}
          </span>
        </li>
      ))}
    </ol>
  );
}

/** Design "عدد الأسامي": − [10] + with 52px buttons. */
export function SlotCountField({ control }: { control: Control<CreateGroupInput, unknown, CreateGroupValues> }) {
  return (
    <Controller
      control={control}
      name="slotCount"
      render={({ field, fieldState }) => {
        const value = Number.isFinite(field.value) ? field.value : 0;
        const set = (n: number) => field.onChange(Math.max(2, Math.min(100, n)));
        return (
          <TextField
            value={Number.isFinite(field.value) ? String(field.value) : ""}
            onChange={(v) => {
              const n = Number.parseInt(v.replace(/[^\d]/g, ""), 10);
              field.onChange(Number.isNaN(n) ? Number.NaN : n);
            }}
            onBlur={field.onBlur}
            isInvalid={fieldState.invalid}
            validationBehavior="aria"
            className="flex flex-col gap-1.5"
          >
            <Label>عدد الأسامي</Label>
            <div className="flex gap-2">
              <Button variant="outline" isIconOnly aria-label="قلّل" onPress={() => set(value - 1)} className="size-[52px]">
                <MinusIcon />
              </Button>
              <Input
                ref={field.ref}
                dir="ltr"
                inputMode="numeric"
                className="min-h-13 py-2 min-w-0 flex-1 rounded-[12px] border-[1.5px] border-line-strong bg-surface text-center text-[1.25rem] font-bold text-ink"
              />
              <Button variant="outline" isIconOnly aria-label="زوّد" onPress={() => set(value + 1)} className="size-[52px]">
                <PlusIcon />
              </Button>
            </div>
            {fieldState.error ? (
              <FieldError>{fieldState.error.message}</FieldError>
            ) : (
              <p className="text-caption text-muted">
                يعني الجمعية هتكمّل {value >= 2 ? cyclesLabel(value) : "…"}
              </p>
            )}
          </TextField>
        );
      }}
    />
  );
}

/** Design "Segmented": شهري / كل 15 يوم. */
export function FrequencyField({
  control,
  onChange,
}: {
  control: Control<CreateGroupInput, unknown, CreateGroupValues>;
  onChange: (f: "monthly" | "semi_monthly") => void;
}) {
  return (
    <Controller
      control={control}
      name="frequency"
      render={({ field }) => (
        <fieldset className="flex flex-col gap-1.5">
          <legend className="mb-1.5 text-label text-ink">كل قد إيه؟</legend>
          <div className="flex gap-1 rounded-[14px] bg-sunken p-1">
            {(["monthly", "semi_monthly"] as const).map((f) => (
              <label
                key={f}
                className={`flex min-h-11 py-1.5 flex-1 cursor-pointer items-center justify-center rounded-[10px] text-[0.9375rem] has-focus-visible:ring-2 has-focus-visible:ring-brand-600 ${
                  field.value === f ? "bg-surface font-bold text-ink shadow-e1" : "font-medium text-muted"
                }`}
              >
                <input
                  type="radio"
                  name={field.name}
                  value={f}
                  checked={field.value === f}
                  onChange={() => {
                    field.onChange(f);
                    onChange(f);
                  }}
                  className="sr-only"
                />
                {frequencyLabel(f)}
              </label>
            ))}
          </div>
        </fieldset>
      )}
    />
  );
}

export function DueDayField({
  control,
  frequency,
}: {
  control: Control<CreateGroupInput, unknown, CreateGroupValues>;
  frequency: "monthly" | "semi_monthly";
}) {
  return (
    <Controller
      control={control}
      name="dueDay"
      render={({ field, fieldState }) => (
        <TextField
          value={Number.isFinite(field.value) ? String(field.value) : ""}
          onChange={(v) => {
            const n = Number.parseInt(v.replace(/[^\d]/g, ""), 10);
            field.onChange(Number.isNaN(n) ? Number.NaN : n);
          }}
          onBlur={field.onBlur}
          isInvalid={fieldState.invalid}
          validationBehavior="aria"
          className="flex flex-col gap-1.5"
        >
          <Label>يوم التحصيل</Label>
          <div className="input-group flex items-center">
            <Input
              ref={field.ref}
              dir="ltr"
              inputMode="numeric"
              className="input-group__input min-w-0 flex-1 border-0 bg-transparent text-right outline-none"
            />
            <span className="text-[0.9375rem] font-medium whitespace-nowrap text-muted">
              {frequency === "monthly" ? "من كل شهر" : "يوم بعد بداية الدورة"}
            </span>
          </div>
          {fieldState.error ? (
            <FieldError>{fieldState.error.message}</FieldError>
          ) : (
            <p className="text-caption text-muted">آخر يوم الأعضاء يدفعوا فيه كل دورة</p>
          )}
        </TextField>
      )}
    />
  );
}

export function SummaryRow({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex flex-wrap items-center justify-between gap-3 border-b border-line py-2.5 last:border-b-0">
      <span className="text-body-sm text-muted">{label}</span>
      <span className="tabular text-body-sm font-semibold text-ink">{value}</span>
    </div>
  );
}

function nextMonthStart(): string {
  const now = new Date();
  const d = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() + 1, 1));
  return d.toISOString().slice(0, 10);
}

/** Design "9 · جمعية جديدة" 1–3. Creates the group as a draft. */
export function CreateGroupWizard() {
  const [step, setStep] = useState(0);
  const [formError, setFormError] = useState<string | null>(null);
  const { control, handleSubmit, trigger, setValue, setError, formState } = useForm<
    CreateGroupInput,
    unknown,
    CreateGroupValues
  >({
    resolver: zodResolver(createGroupSchema),
    defaultValues: {
      name: "",
      slotAmount: "",
      slotCount: 10,
      frequency: "monthly",
      startDate: nextMonthStart(),
      dueDay: 5,
    },
  });
  const v = useWatch({ control });

  const amount = parseAmountInput(v.slotAmount ?? "");
  const count = Number.isFinite(v.slotCount) ? (v.slotCount as number) : 0;
  const scheduleOk =
    v.startDate && /^\d{4}-\d{2}-\d{2}$/.test(v.startDate) && Number.isFinite(v.dueDay) && count >= 2;
  const schedule = scheduleOk
    ? buildSchedule({
        startDate: v.startDate as string,
        frequency: v.frequency ?? "monthly",
        dueDay: v.dueDay as number,
        cycles: count,
      })
    : [];
  const duration =
    v.frequency === "semi_monthly" ? `${count * SEMI_MONTHLY_DAYS} يوم` : monthsLabel(count);

  async function next() {
    if (await trigger(STEP_FIELDS[step])) setStep((s) => s + 1);
  }

  const onSubmit = handleSubmit(async (values) => {
    setFormError(null);
    setFormError(applyActionErrors(await createGroupAction(values), setError));
  });

  return (
    <form onSubmit={onSubmit} noValidate className="flex min-h-0 flex-1 flex-col">
      <div className="flex flex-1 flex-col gap-5 px-4 pt-4 pb-5">
        <p className="sr-only" aria-live="polite">
          خطوة {step + 1} من 3: {STEPS[step]}
        </p>
        <StepsBar step={step} />
        {formError && <Notice title={formError} />}

        {step === 0 && (
          <>
            <FormTextField control={control} name="name" label="اسم الجمعية" placeholder="جمعية العيلة" />
            <FormTextField
              control={control}
              name="slotAmount"
              label="قيمة الاسم"
              ltr
              inputMode="decimal"
              placeholder="1,000"
              suffix="ج.م"
              hint={{ text: "المبلغ اللي بيدفعه الاسم كل دورة" }}
            />
            <SlotCountField control={control} />
            <Notice tone="accent" title="الاسم مش شخص" icon={<InfoIcon />}>
              اسم واحد ممكن يتقسم على أكتر من حد، وشخص واحد ممكن يبقى ليه حتة في أكتر من اسم. التقسيم ده
              بتعمله بعد ما تضيف الأعضاء.
            </Notice>
          </>
        )}

        {step === 1 && (
          <>
            <FrequencyField
              control={control}
              onChange={(f) => setValue("dueDay", f === "monthly" ? 5 : 0, { shouldValidate: true })}
            />
            <FormTextField
              control={control}
              name="startDate"
              label="أول دورة"
              type="date"
              icon={<CalendarIcon />}
            />
            <DueDayField control={control} frequency={v.frequency ?? "monthly"} />
            {schedule.length > 0 && (
              <section className="flex flex-col gap-1 rounded-lg border border-line bg-surface p-4">
                <p className="text-label text-ink">المواعيد</p>
                <SummaryRow label="أول تحصيل" value={formatDate(schedule[0].dueOn)} />
                <SummaryRow label="آخر تحصيل" value={formatDate(schedule.at(-1)!.dueOn)} />
                <SummaryRow label="المدة" value={duration} />
              </section>
            )}
          </>
        )}

        {step === 2 && (
          <>
            <section className="flex flex-col items-center gap-1 rounded-lg bg-brand-600 p-5 text-center text-white">
              <span className="text-body-sm opacity-90">مجموع كل دورة</span>
              <span className="tabular text-amount-xl">{amount ? formatEGP(multiplyAmount(amount, count)) : "—"}</span>
              <span className="tabular text-caption opacity-90">
                {amount ? formatEGP(amount) : "—"} × {slotsLabel(count)}
              </span>
            </section>

            <section className="flex flex-col gap-1 rounded-lg border border-line bg-surface p-4">
              <div className="flex items-center justify-between">
                <p className="text-label text-ink">الأساسيات</p>
                <Button variant="ghost" size="sm" onPress={() => setStep(0)}>
                  عدّل
                </Button>
              </div>
              <SummaryRow label="الاسم" value={v.name ?? ""} />
              <SummaryRow label="قيمة الاسم" value={amount ? formatEGP(amount) : "—"} />
              <SummaryRow label="عدد الأسامي" value={String(count)} />
            </section>

            <section className="flex flex-col gap-1 rounded-lg border border-line bg-surface p-4">
              <div className="flex items-center justify-between">
                <p className="text-label text-ink">المواعيد</p>
                <Button variant="ghost" size="sm" onPress={() => setStep(1)}>
                  عدّل
                </Button>
              </div>
              <SummaryRow label="كل قد إيه" value={frequencyLabel(v.frequency ?? "monthly")} />
              <SummaryRow label="أول دورة" value={v.startDate ? formatDate(v.startDate) : "—"} />
              <SummaryRow
                label="يوم التحصيل"
                value={
                  v.frequency === "semi_monthly"
                    ? `بعد بداية الدورة بـ ${v.dueDay} يوم`
                    : `${v.dueDay} من كل شهر`
                }
              />
            </section>

            <Notice tone="accent" title="هتتعمل كمسودة" icon={<InfoIcon />}>
              ضيف الأعضاء وقسّم الأسامي ورتّب الأدوار براحتك، وبعدين ابدأ الجمعية.
            </Notice>
          </>
        )}
      </div>

      <div className="sticky bottom-0 flex gap-2.5 border-t border-line bg-surface px-4 pt-3 pb-4 shadow-[0_-4px_16px_rgba(31,29,26,0.05)]">
        {step > 0 && (
          <Button variant="outline" size="lg" className="flex-1" onPress={() => setStep((s) => s - 1)}>
            رجوع
          </Button>
        )}
        {step < 2 ? (
          <Button size="lg" className="flex-[2]" onPress={next}>
            التالي
          </Button>
        ) : (
          <Button type="submit" size="lg" className="flex-[2]" isPending={formState.isSubmitting}>
            اعمل الجمعية
          </Button>
        )}
      </div>
    </form>
  );
}
