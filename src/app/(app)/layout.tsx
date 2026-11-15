import { requireUser } from "@/server/auth/dal";

/** Every signed-in screen. Pages and actions still call requireUser() themselves. */
export default async function AppLayout({ children }: LayoutProps<"/">) {
  await requireUser();
  return <div className="mx-auto flex min-h-dvh w-full max-w-md flex-col bg-paper">{children}</div>;
}
