import type { Metadata } from "next";
import Link from "next/link";
import { ChevronIcon, InfoIcon } from "@/components/ui/icons";
import { cyclesLabel, frequencyLabel, requestsLabel, slotsLabel } from "@/lib/arabic";
import { PaymentStatusChip } from "@/components/ui/payment-status";
import { Progress } from "@/components/ui/states";
import { formatDate, formatDayMonth, todayInCairo } from "@/lib/dates";
import { currentCycleTotals } from "@/server/services/collections";
import { formatEGP, multiplyAmount, splitPot } from "@/lib/money";
import { buildSchedule } from "@/lib/schedule";
import { PayoutList } from "@/features/groups/payout-list";
import { StartGroupButton } from "@/features/groups/start-group-button";
import {
  countPendingLinkRequests,
  getGroupMembers,
  getGroupSlots,
  requireGroupAccess,
} from "@/server/services/group-detail";

export const metadata: Metadata = { title: "الجمعية · جمعيتي" };

function SetupStep({
  href,
  title,
  detail,
  done,
}: {
  href: string;
  title: string;
  detail: string;
  done: boolean;
}) {
  return (
    <Link href={href} className="flex min-h-16 items-center gap-3 px-4 py-3">
      <span
        aria-hidden="true"
        className={`size-2.5 shrink-0 rounded-full ${done ? "bg-brand-600" : "bg-warning"}`}
      />
      <div className="flex min-w-0 flex-1 flex-col">
        <span className="text-body-sm font-semibold text-ink">{title}</span>
        <span className="text-caption text-muted">{detail}</span>
      </div>
      <ChevronIcon className="text-muted" />
    </Link>
  );
}

/** Design "10 · صفحة الجمعية: عضو" / "11 · أدمن" (no payment data until the collections step). */
export default async function GroupOverviewPage({ params }: PageProps<"/groups/[groupId]">) {
  const { groupId } = await params;
  const ctx = await requireGroupAccess(groupId);
  const { group } = ctx;
  const [slots, members, pending, totals] = await Promise.all([
    getGroupSlots(ctx),
    group.isManager ? getGroupMembers(ctx) : Promise.resolve([]),
    countPendingLinkRequests(ctx),
    // Admin-only financial summary; never fetched for ordinary members.
    group.canCollect && group.status === "active"
      ? currentCycleTotals(group.id, group.currentCycle)
      : Promise.resolve(null),
  ]);
  const fullSlots = slots.filter((s) => s.fill === "full").length;
  const ready = slots.length >= 2 && fullSlots === slots.length;
  const base = `/groups/${group.id}`;
  const pot = multiplyAmount(group.slotAmount, slots.length);
  const schedule = buildSchedule({
    startDate: ctx.startDate,
    frequency: group.frequency,
    dueDay: ctx.dueDay,
    cycles: slots.length,
  });
  // Before the first cycle starts, show the first turn.
  const turnSlot = slots.find((s) => s.payoutOrder === Math.max(1, group.currentCycle));
  const turnShares = turnSlot
    ? splitPot(pot, group.slotAmount, turnSlot.owners.map((o) => o.amount))
    : [];

  return (
    <main className="flex flex-col gap-4 px-4 pt-4 pb-6">
      <section className="grid grid-cols-[repeat(auto-fit,minmax(min(8rem,100%),1fr))] divide-x divide-x-reverse divide-line rounded-lg border border-line bg-surface shadow-e1">
        <div className="flex flex-col gap-0.5 p-4">
          <span className="text-caption text-muted">
            قيمة الاسم · {frequencyLabel(group.frequency)} · {slotsLabel(group.slotCount)}
          </span>
          <span className="tabular text-amount-md text-ink">{formatEGP(group.slotAmount)}</span>
        </div>
        <div className="flex flex-col gap-0.5 p-4">
          <span className="text-caption text-muted">الدورة</span>
          <span className="tabular text-amount-md text-ink">
            {group.status === "active"
              ? `${group.currentCycle} من ${group.totalCycles}`
              : group.status === "draft"
                ? "لسه مبدأتش"
                : `${group.totalCycles} من ${group.totalCycles}`}
          </span>
        </div>
      </section>

      {group.isManager && pending > 0 && (
        <Link
          href={`${base}/requests`}
          className="flex min-h-16 items-center gap-3 rounded-lg border border-line bg-surface px-4 py-3 shadow-e1"
        >
          <div className="flex min-w-0 flex-1 flex-col">
            <span className="text-body-sm font-semibold text-ink">طلبات ربط مستنية</span>
            <span className="text-caption text-muted">الحاجات دي باينة ليك إنت بس كأدمن</span>
          </div>
          <span
            aria-label={requestsLabel(pending)}
            className="flex min-h-7 py-0.5 min-w-7 items-center justify-center rounded-full bg-brand-600 px-2 text-caption font-bold text-white"
          >
            {pending}
          </span>
          <ChevronIcon className="text-muted" />
        </Link>
      )}

      {totals && (
        <section aria-labelledby="collect" className="flex flex-col gap-3 rounded-lg border border-line bg-surface p-4 shadow-e1">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <h2 id="collect" className="text-title-3 text-ink">
              تحصيل الدورة {group.currentCycle}
            </h2>
            <span className="text-caption text-muted">آخر ميعاد {formatDayMonth(totals.dueOn)}</span>
          </div>
          <p className="flex flex-wrap items-baseline gap-1.5">
            <span className="tabular text-amount-lg text-ink">{formatEGP(totals.collected)}</span>
            <span className="text-body-sm text-muted">من {formatEGP(totals.expected)}</span>
          </p>
          <Progress value={Number(totals.collected)} max={Number(totals.expected)} label="التحصيل" />
          <div className="flex flex-wrap gap-1.5">
            <PaymentStatusChip status="paid" count={totals.counts.paid} />
            {totals.counts.partially_paid > 0 && (
              <PaymentStatusChip status="partially_paid" count={totals.counts.partially_paid} />
            )}
            {totals.counts.overdue > 0 && <PaymentStatusChip status="overdue" count={totals.counts.overdue} />}
          </div>
          <Link href={`${base}/collection`} className="button button--secondary w-full">
            افتح التحصيل
          </Link>
          <p className="text-caption text-muted">الحاجات دي باينة ليك إنت بس</p>
        </section>
      )}

      {group.isManager && group.status === "draft" && (
        <section aria-labelledby="setup" className="flex flex-col gap-2">
          <h2 id="setup" className="text-title-3 text-ink">
            جهّز الجمعية
          </h2>
          <div className="flex flex-col divide-y divide-line rounded-lg border border-line bg-surface shadow-e1">
            <SetupStep
              href={`${base}/members`}
              title="ضيف الأعضاء"
              detail={members.length ? `${members.length} عضو لحد دلوقتي` : "لسه مفيش أعضاء"}
              done={members.length > 0}
            />
            <SetupStep
              href={`${base}/names`}
              title="قسّم الأسامي"
              detail={`${fullSlots} من ${slots.length} كاملين`}
              done={slots.length > 0 && fullSlots === slots.length}
            />
            <SetupStep href={`${base}/order`} title="رتّب أدوار القبض" detail="مين يقبض الأول" done={false} />
          </div>
          <div className="mt-2 flex flex-col gap-2">
            <StartGroupButton
              groupId={group.id}
              ready={ready}
              summary={{
                cycles: cyclesLabel(slots.length),
                pot: formatEGP(pot),
                firstDue: schedule[0] ? formatDate(schedule[0].dueOn) : "—",
                lastDue: schedule.at(-1) ? formatDate(schedule.at(-1)!.dueOn) : "—",
                startPassed: ctx.startDate < todayInCairo(),
              }}
            />
            {!ready && (
              <p className="flex items-center gap-1.5 text-caption text-muted">
                <InfoIcon size={16} />
                لازم كل الأسامي تبقى متقسمة كاملة قبل ما تبدأ الجمعية.
              </p>
            )}
          </div>
        </section>
      )}

      {group.status === "active" && turnSlot && (
        <section aria-labelledby="payout" className="flex flex-col gap-3 rounded-lg border border-line bg-surface p-4 shadow-e1">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <h2 id="payout" className="text-title-3 text-ink">
              {group.currentCycle === 0 ? "أول قبض" : "القبض في الدورة دي"}
            </h2>
            <span className="rounded-full bg-brand-600 px-2.5 text-[0.78125rem] leading-6.5 font-semibold text-white">
              اسم {turnSlot.slotNumber}
            </span>
          </div>
          <ul className="flex flex-col gap-2">
            {turnSlot.owners.map((owner, i) => (
              <li key={owner.memberId} className="flex flex-wrap items-center justify-between gap-3">
                <span className="text-body-sm text-body">
                  {owner.name}
                  {owner.isMe && <span className="text-muted"> (إنت)</span>}
                </span>
                <span className="tabular text-amount-sm text-ink">{formatEGP(turnShares[i])}</span>
              </li>
            ))}
          </ul>
          <p className="text-caption text-muted">
            {group.currentCycle === 0 ? "الجمعية هتبدأ " : "ميعاد القبض "}
            {formatDate(turnSlot.payoutDate)} · مجموع الدورة {formatEGP(pot)}
          </p>
          {group.isManager && group.currentCycle > 0 && (
            <Link href={`${base}/payouts`} className="button button--primary w-full">
              سجّل القبض
            </Link>
          )}
        </section>
      )}

      {group.myShares.length > 0 && (
        <section aria-labelledby="mine" className="flex flex-col gap-2">
          <h2 id="mine" className="text-title-3 text-ink">
            نصيبك في الجمعية دي
          </h2>
          <div className="flex flex-col divide-y divide-line rounded-lg border border-line bg-surface shadow-e1">
            {group.myShares.map((share) => (
              <div key={share.slotNumber} className="flex flex-wrap items-center justify-between gap-3 px-4 py-3">
                <span className="text-body-sm text-body">
                  اسم {share.slotNumber}{" "}
                  <span className="tabular font-semibold text-ink">{formatEGP(share.amount)}</span>
                  {share.coOwners.length > 0 && <span className="text-muted"> مع {share.coOwners.join(" و")}</span>}
                </span>
                {share.payoutDate && (
                  <span className="shrink-0 rounded-full bg-brand-50 px-2.5 py-0.5 text-caption font-semibold text-brand-700">
                    {formatDate(share.payoutDate)}
                  </span>
                )}
              </div>
            ))}
          </div>
        </section>
      )}

      <section aria-labelledby="order" className="flex flex-col gap-2">
        <div className="flex items-center justify-between">
          <h2 id="order" className="text-title-3 text-ink">
            ترتيب القبض
          </h2>
          {group.isManager && group.status === "draft" && (
            <Link href={`${base}/order`} className="button button--ghost">
              رتّب
            </Link>
          )}
        </div>
        <PayoutList slots={slots} currentCycle={group.currentCycle} />
      </section>
    </main>
  );
}
