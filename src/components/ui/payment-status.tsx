import type { PaymentStatus } from "@/server/services/collections";
import { AlertCircleIcon, CheckIcon, DotIcon } from "./icons";

/**
 * Design "حالات الدفع (أدمن بس)": icon + word + color.
 * NEVER render this on a screen an ordinary member can open (BUSINESS_RULES.md §9).
 */
export const PAYMENT_STATUS: Record<PaymentStatus, { label: string; chip: string; dot: string }> = {
  paid: { label: "مدفوع", chip: "border-paid-line bg-paid-soft text-paid", dot: "bg-paid" },
  partially_paid: { label: "دفع جزء", chip: "border-partial-line bg-partial-soft text-partial", dot: "bg-partial" },
  unpaid: { label: "لسه مدفعش", chip: "border-unpaid-line bg-unpaid-soft text-unpaid", dot: "bg-unpaid" },
  overdue: { label: "متأخر", chip: "border-overdue-line bg-overdue-soft text-overdue", dot: "bg-overdue" },
};

const ICON: Record<PaymentStatus, React.ReactNode> = {
  paid: <CheckIcon size={14} />,
  partially_paid: <DotIcon size={14} />,
  unpaid: <DotIcon size={14} />,
  overdue: <AlertCircleIcon size={14} />,
};

export function PaymentStatusChip({ status, count }: { status: PaymentStatus; count?: number }) {
  const s = PAYMENT_STATUS[status];
  return (
    <span className={`inline-flex h-7 shrink-0 items-center gap-1 rounded-full border px-2.5 text-caption font-semibold ${s.chip}`}>
      {ICON[status]}
      {s.label}
      {count !== undefined && <b className="tabular">{count}</b>}
    </span>
  );
}
