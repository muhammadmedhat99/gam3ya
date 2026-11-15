"use client";

import { Button, FieldError, InputGroup, Label, TextField } from "@heroui/react";
import { useState, type ComponentProps, type ReactNode } from "react";
import { Controller, type Control, type FieldValues, type Path } from "react-hook-form";
import { AlertCircleIcon, CheckIcon, DotIcon, EyeIcon, EyeOffIcon } from "@/components/ui/icons";

export interface FieldHint {
  text: string;
  /** Live check (e.g. "8 حروف أو أكتر"): true shows a check in brand color. */
  met?: boolean;
}

interface FormTextFieldProps<T extends FieldValues> {
  control: Control<T>;
  name: Path<T>;
  label: string;
  type?: "text" | "password" | "tel" | "date";
  /** Unit text after the value, e.g. "ج.م" or "من كل شهر". */
  suffix?: string;
  autoComplete?: string;
  inputMode?: ComponentProps<"input">["inputMode"];
  /** Phone numbers and amounts: LTR inside the RTL field, aligned to the start. */
  ltr?: boolean;
  placeholder?: string;
  icon?: ReactNode;
  hint?: FieldHint;
  isDisabled?: boolean;
  /** Mark invalid without a message (e.g. both fields after "wrong credentials"). */
  forceInvalid?: boolean;
}

/** Design field: label, 52px shell with optional icon, password toggle, hint or error row. */
export function FormTextField<T extends FieldValues>({
  control,
  name,
  label,
  type = "text",
  suffix,
  autoComplete,
  inputMode,
  ltr,
  placeholder,
  icon,
  hint,
  isDisabled,
  forceInvalid,
}: FormTextFieldProps<T>) {
  const [revealed, setRevealed] = useState(false);
  const isPassword = type === "password";

  return (
    <Controller
      control={control}
      name={name}
      render={({ field, fieldState }) => {
        const invalid = fieldState.invalid || Boolean(forceInvalid);
        return (
          <TextField
            fullWidth
            name={field.name}
            type={isPassword && revealed ? "text" : type}
            value={(field.value as string | undefined) ?? ""}
            onChange={field.onChange}
            onBlur={field.onBlur}
            isInvalid={invalid}
            isDisabled={isDisabled}
            validationBehavior="aria"
            autoComplete={autoComplete}
            className="flex flex-col gap-1.5"
          >
            <Label>{label}</Label>
            <InputGroup fullWidth>
              {icon && <InputGroup.Prefix>{icon}</InputGroup.Prefix>}
              <InputGroup.Input
                ref={field.ref}
                dir={ltr ? "ltr" : undefined}
                inputMode={inputMode}
                placeholder={placeholder}
                className={ltr ? "text-right" : undefined}
              />
              {suffix && (
                <InputGroup.Suffix className="text-[15px] font-medium whitespace-nowrap text-muted">
                  {suffix}
                </InputGroup.Suffix>
              )}
              {isPassword && (
                <InputGroup.Suffix>
                  <Button
                    variant="ghost"
                    isIconOnly
                    isDisabled={isDisabled}
                    aria-label={revealed ? "اخفي كلمة السر" : "اظهر كلمة السر"}
                    onPress={() => setRevealed((v) => !v)}
                    className="text-muted"
                  >
                    {revealed ? <EyeOffIcon size={22} /> : <EyeIcon size={22} />}
                  </Button>
                </InputGroup.Suffix>
              )}
            </InputGroup>
            {fieldState.error?.message ? (
              <FieldError>
                <AlertCircleIcon size={16} />
                <span>{fieldState.error.message}</span>
              </FieldError>
            ) : hint ? (
              <p
                className={`flex items-center gap-1.5 text-caption ${
                  hint.met ? "font-semibold text-brand-700" : "text-muted"
                }`}
              >
                {hint.met !== undefined &&
                  (hint.met ? (
                    <CheckIcon size={16} className="text-brand-600" />
                  ) : (
                    <DotIcon size={16} />
                  ))}
                {hint.text}
              </p>
            ) : null}
          </TextField>
        );
      }}
    />
  );
}
