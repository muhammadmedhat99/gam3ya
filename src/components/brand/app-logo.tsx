import { CoinsIcon } from "@/components/ui/icons";

export function AppLogo() {
  return (
    <div className="flex items-center gap-3.5">
      <span className="flex size-14 shrink-0 items-center justify-center rounded-[18px] bg-brand-600 text-white">
        <CoinsIcon size={30} />
      </span>
      <div className="flex flex-col">
        <p className="text-display text-ink">جمعيتي</p>
        <p className="text-body-sm text-muted">دفتر جمعيتك، مترتب ومضمون</p>
      </div>
    </div>
  );
}
