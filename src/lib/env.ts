import "server-only";
import { z } from "zod";

const serverEnvSchema = z.object({
  NEXT_PUBLIC_SUPABASE_URL: z.url({ message: "NEXT_PUBLIC_SUPABASE_URL must be the project URL" }),
  SUPABASE_SECRET_KEY: z
    .string({ message: "SUPABASE_SECRET_KEY is missing (Dashboard → Project Settings → API Keys)" })
    .min(20, "SUPABASE_SECRET_KEY looks too short"),
});

export type ServerEnv = z.infer<typeof serverEnvSchema>;

let cached: ServerEnv | undefined;

/** Read lazily so `next build` doesn't need secrets; fails loudly on first use. */
export function serverEnv(): ServerEnv {
  if (cached) return cached;
  const parsed = serverEnvSchema.safeParse(process.env);
  if (!parsed.success) {
    const details = parsed.error.issues.map((i) => `- ${i.path.join(".")}: ${i.message}`).join("\n");
    throw new Error(`Invalid server environment. Check .env.local:\n${details}`);
  }
  if (parsed.data.SUPABASE_SECRET_KEY.startsWith("sb_publishable_")) {
    throw new Error("SUPABASE_SECRET_KEY contains a publishable key. Use the sb_secret_ key.");
  }
  cached = parsed.data;
  return cached;
}
