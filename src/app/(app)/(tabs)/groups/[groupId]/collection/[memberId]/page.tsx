import type { Metadata } from "next";
import Link from "next/link";
import { BackIcon } from "@/components/ui/icons";
import { formatAmount, formatEGP } from "@/lib/money";
import { formatEgyptPhone } from "@/lib/phone";
import { MemberHistory } from "@/features/collections/member-history";
import { getMemberPayments, requireCollector } from "@/server/services/collections";

export const metadata: Metadata = { title: "سجل المدفوعات · جمعيتي" };

/** Admin/collector only. Corrections (reversals) are for owners/admins. */
export default async function MemberPaymentsPage({
  params,
}: PageProps<"/groups/[groupId]/collection/[memberId]">) {
  const { groupId, memberId } = await params;
  const ctx = await requireCollector(groupId);
  const history = await getMemberPayments(ctx, memberId);

  return (
    <main className="flex flex-col gap-3 px-4 pt-3 pb-6">
      <div className="flex items-center gap-1">
        <Link
          href={`/groups/${groupId}/collection`}
          aria-label="رجوع للتحصيل"
          className="button button--ghost button--icon-only text-ink"
        >
          <BackIcon size={22} />
        </Link>
        <div className="flex min-w-0 flex-col">
          <h2 className="truncate text-title-2 text-ink">مدفوعات {history.name}</h2>
          <p className="text-caption text-muted">{ctx.group.name} · كل الدورات</p>
        </div>
      </div>

      <section className="flex flex-col gap-2 rounded-lg border border-line bg-surface p-4 shadow-e1">
        {history.phone && (
          <span dir="ltr" className="tabular text-right text-body-sm text-muted">
            {formatEgyptPhone(history.phone)}
          </span>
        )}
        <div className="flex flex-wrap gap-2">
          {history.breakdown.map((p) => (
            <span key={p.slotNumber} className="rounded-full bg-surface-2 px-2.5 py-0.5 text-caption text-body">
              اسم {p.slotNumber} · <span className="tabular font-semibold">{formatAmount(p.amount)}</span>
            </span>
          ))}
        </div>
        <p className="text-body-sm text-muted">
          كل دورة <span className="tabular font-semibold text-ink">{formatEGP(history.perCycle)}</span>
        </p>
      </section>

      <MemberHistory groupId={groupId} cycles={history.cycles} canReverse={ctx.group.isManager} />
    </main>
  );
}
