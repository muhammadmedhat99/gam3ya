import { BottomNav } from "@/components/layout/bottom-nav";

/** Screens with the bottom navigation (design: 4 tabs). */
export default function TabsLayout({ children }: LayoutProps<"/">) {
  return (
    <>
      <div className="flex flex-1 flex-col pb-[88px]">{children}</div>
      <BottomNav />
    </>
  );
}
