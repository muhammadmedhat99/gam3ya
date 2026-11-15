export default function AuthLayout({ children }: LayoutProps<"/">) {
  return <div className="mx-auto flex min-h-dvh w-full max-w-md flex-col bg-paper">{children}</div>;
}
