import type { Metadata } from "next";
import Link from "next/link";
import { BackIcon, CalendarIcon, ChevronIcon } from "@/components/ui/icons";
import { PaymentStatusChip } from "@/components/ui/payment-status";
import { formatDate } from "@/lib/dates";
import { formatAmount, formatEGP, toPiasters } from "@/lib/money";
import { CollectionView } from "@/features/collections/collection-view";
import { getCycleCollection, requireCollector } from "@/server/services/collections";

export const metadata: Metadata = { title: "التحصيل · جمعيتي" };

/** Design "17 · التحصيل". Owner/admin/collector only; everyone else gets a 404. */
export default async function CollectionPage({ params, searchParams }: PageProps<"/groups/[groupId]/collection">) {
  const { groupId } = await params;
  const { cycle } = await searchParams;
  const ctx = await requireCollector(groupId);
  const requested = Number.parseInt(typeof cycle === "string" ? cycle : "", 10);
  const data = await getCycleCollection(ctx, Number.isFinite(requested) ? requested : undefined);
  const { cycle: c, cycles } = data;

  const pct =
    toPiasters(data.expected) > 0n
      ? Number((toPiasters(data.collected) * 1000n) / toPiasters(data.expected)) / 10
      : 0;
  const prev = cycles.find((x) => x.number === c.number - 1);
  const next = cycles.find((x) => x.number === c.number + 1);
  const base = `/groups/${groupId}/collection`;

  return (
    <main className="flex flex-col gap-3 px-4 pt-4 pb-6">
      <nav aria-label="اختار الدورة" className="flex flex-wrap items-center justify-between gap-2">
        {prev ? (
          <Link href={`${base}?cycle=${prev.number}`} className="button button--ghost" aria-label={`الدورة ${prev.number}`}>
            <BackIcon />
            {prev.number}
          </Link>
        ) : (
          <span className="w-11" />
        )}
        <span className="text-body-sm font-semibold text-body">
          الدورة {c.number} من {cycles.length}
          {c.number === ctx.group.currentCycle && <span className="text-muted"> · الحالية</span>}
        </span>
        {next ? (
          <Link href={`${base}?cycle=${next.number}`} className="button button--ghost" aria-label={`الدورة ${next.number}`}>
            {next.number}
            <ChevronIcon />
          </Link>
        ) : (
          <span className="w-11" />
        )}
      </nav>

      <section className="flex flex-col gap-3 rounded-lg border border-line bg-surface p-4 shadow-e1">
        <div className="flex items-center gap-2">
          <h2 className="flex-1 text-title-3 text-ink">الدورة {c.number}</h2>
          <span className="inline-flex min-h-[26px] py-0.5 items-center gap-1 rounded-full border border-line bg-surface-2 px-[9px] text-[0.78125rem] font-semibold text-body">
            <CalendarIcon size={14} />
            آخر ميعاد {formatDate(c.dueOn)}
          </span>
        </div>
        <div className="flex flex-col gap-2">
          <p className="flex flex-wrap items-baseline gap-1.5">
            <span className="tabular text-[1.75rem] leading-9 font-bold text-ink">{formatAmount(data.collected)}</span>
            <span className="text-[1.0625rem] font-medium text-muted">ج.م</span>
            <span className="text-body-sm text-muted">من</span>
            <span className="tabular text-title-3 text-muted">{formatEGP(data.expected)}</span>
          </p>
          <div
            role="progressbar"
            aria-valuemin={0}
            aria-valuemax={100}
            aria-valuenow={Math.round(pct)}
            aria-label="التحصيل"
            className="h-2.5 overflow-hidden rounded-full bg-sunken"
          >
            <div className="h-full rounded-full bg-brand-600" style={{ width: `${pct}%` }} />
          </div>
        </div>
        <div className="flex flex-wrap gap-1.5">
          <PaymentStatusChip status="paid" count={data.counts.paid} />
          {data.counts.partially_paid > 0 && <PaymentStatusChip status="partially_paid" count={data.counts.partially_paid} />}
          {data.counts.unpaid > 0 && <PaymentStatusChip status="unpaid" count={data.counts.unpaid} />}
          {data.counts.overdue > 0 && <PaymentStatusChip status="overdue" count={data.counts.overdue} />}
        </div>
      </section>

      <CollectionView
        // reset the filter when switching cycles
        key={c.number}
        groupId={groupId}
        cycleNumber={c.number}
        rows={data.rows}
        counts={data.counts}
      />
    </main>
  );
}
