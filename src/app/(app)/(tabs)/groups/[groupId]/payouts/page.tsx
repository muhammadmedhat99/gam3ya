import type { Metadata } from "next";
import Link from "next/link";
import { BackIcon, ChevronIcon } from "@/components/ui/icons";
import { formatDate } from "@/lib/dates";
import { formatEGP } from "@/lib/money";
import { PayoutsView } from "@/features/payouts/payouts-view";
import { getCyclePayout, requirePayoutManager } from "@/server/services/payouts";

export const metadata: Metadata = { title: "القبض · جمعيتي" };

/** Payout recording per cycle. Owner/admin only (not collectors, not members). */
export default async function PayoutsPage({ params, searchParams }: PageProps<"/groups/[groupId]/payouts">) {
  const { groupId } = await params;
  const { cycle } = await searchParams;
  const ctx = await requirePayoutManager(groupId);
  const requested = Number.parseInt(typeof cycle === "string" ? cycle : "", 10);
  const data = await getCyclePayout(ctx, Number.isFinite(requested) ? requested : undefined);
  const prev = data.cycles.find((c) => c.number === data.cycle.number - 1);
  const next = data.cycles.find((c) => c.number === data.cycle.number + 1);
  const base = `/groups/${groupId}/payouts`;

  return (
    <main className="flex flex-col gap-3 px-4 pt-4 pb-6">
      <nav aria-label="اختار الدورة" className="flex items-center justify-between gap-2">
        {prev ? (
          <Link href={`${base}?cycle=${prev.number}`} className="button button--ghost" aria-label={`الدورة ${prev.number}`}>
            <BackIcon />
            {prev.number}
          </Link>
        ) : (
          <span className="w-11" />
        )}
        <span className="text-body-sm font-semibold text-body">
          الدورة {data.cycle.number} من {data.cycles.length}
          {data.cycle.number === ctx.group.currentCycle && <span className="text-muted"> · الحالية</span>}
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

      <section className="flex flex-col gap-1 rounded-lg bg-brand-600 p-4 text-white">
        <span className="text-body-sm opacity-90">
          {data.slotNumber ? `اسم ${data.slotNumber} بيقبض` : "مفيش اسم في الترتيب ده"} · {formatDate(data.cycle.dueOn)}
        </span>
        <span className="tabular text-amount-xl">{formatEGP(data.pot)}</span>
        <span className="tabular text-caption opacity-90">
          اتحصّل لحد دلوقتي {formatEGP(data.collected)}
          {!data.recorded && " · النصيب محسوب من الترتيب الحالي"}
        </span>
      </section>

      <PayoutsView key={data.cycle.id} groupId={groupId} data={data} />
    </main>
  );
}
