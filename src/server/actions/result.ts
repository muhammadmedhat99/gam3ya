import { z } from "zod";

/** What a form Server Action returns when it doesn't redirect. */
export interface ActionError {
  error?: string;
  fieldErrors?: Record<string, string>;
}

/** Login has richer states because the screens show them (design: Login-Error, Login-Locked). */
export type LoginResult =
  | { kind: "invalid"; attemptsLeft: number }
  | { kind: "locked"; until: string }
  | { kind: "error"; message: string };

export type RegisterResult = ActionError & { phoneTaken?: boolean };

export function fromZodError(error: z.ZodError): ActionError {
  const flat = z.flattenError(error);
  const fieldErrors: Record<string, string> = {};
  for (const [field, messages] of Object.entries(flat.fieldErrors)) {
    const first = (messages as string[] | undefined)?.[0];
    if (first) fieldErrors[field] = first;
  }
  return { error: flat.formErrors[0], fieldErrors };
}
