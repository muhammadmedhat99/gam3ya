import type { FieldValues, Path, UseFormSetError } from "react-hook-form";
import type { ActionError } from "@/server/actions/result";

/** Copies server-side field errors into the form; returns the form-level message, if any. */
export function applyActionErrors<T extends FieldValues>(
  result: ActionError | undefined,
  setError: UseFormSetError<T>,
): string | null {
  if (!result) return null;
  for (const [field, message] of Object.entries(result.fieldErrors ?? {})) {
    setError(field as Path<T>, { type: "server", message });
  }
  return result.error ?? null;
}
