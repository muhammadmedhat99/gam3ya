import Link from "next/link";
import { GroupStatusChip, RoleChip } from "@/components/ui/chips";
import { ChevronIcon } from "@/components/ui/icons";
import { Progress } from "@/components/ui/states";
import { frequencyLabel, slotsLabel } from "@/lib/arabic";
import { formatDayMonth, formatMonthYear } from "@/lib/dates";
import { formatEGP } from "@/lib/money";
import type { GroupSummary } from "@/server/services/groups";

function GroupCardHeader({ group }: { group: GroupSummary }) {
  return (
    <div className="flex items-start gap-2">
      <div className="flex min-w-0 flex-1 flex-col gap-0.5">
        <span className="text-title-3 text-ink">{group.name}</span>
        <span className="text-caption text-muted">
          <span className="tabular">{formatEGP(group.slotAmount)}</span> للاسم · {slotsLabel(group.slotCount)} ·{" "}
          {frequencyLabel(group.frequency)}
        </span>
      </div>
      <ChevronIcon className="mt-1 text-muted" />
    </div>
  );
}

function ownersText(owners: string[]): string {
  if (owners.length === 0) return "لسه مش متقسم";
  if (owners.length === 1) return owners[0];
  return `${owners.slice(0, -1).join(" و")} و${owners.at(-1)}`;
}

/** Design "جمعياتي": role + status, progress, next date or draft hint. */
export function GroupListCard({ group }: { group: GroupSummary }) {
  return (
    <Link
      href={`/groups/${group.id}`}
      className="flex flex-col gap-3 rounded-lg border border-line bg-surface p-4 shadow-e1 outline-none focus-visible:ring-2 focus-visible:ring-brand-600"
    >
      <GroupCardHeader group={group} />
      <div className="flex gap-1.5">
        <RoleChip role={group.role} />
        <GroupStatusChip status={group.status} />
      </div>
      {group.status === "draft" ? (
        <p className="text-caption text-muted">
          لسه مبدأتش{group.isManager ? " · كمّل الأعضاء والأسامي" : ""}
        </p>
      ) : (
        <div className="flex flex-col gap-1.5">
          <div className="flex items-center justify-between gap-2 text-caption">
            <span className="font-semibold text-body">
              الدورة {group.currentCycle} من {group.totalCycles}
            </span>
            <span className="text-muted">
              {group.status === "completed" && group.lastDueOn
                ? `خلصت ${formatMonthYear(group.lastDueOn)}`
                : group.nextDueOn
                  ? `الجاية ${formatDayMonth(group.nextDueOn)}`
                  : ""}
            </span>
          </div>
          <Progress value={group.currentCycle} max={group.totalCycles} label="التقدم" />
        </div>
      )}
    </Link>
  );
}

/** Design "الرئيسية": whose turn this cycle, and the user's own shares. Never payment status. */
export function GroupHomeCard({ group }: { group: GroupSummary }) {
  return (
    <Link
      href={`/groups/${group.id}`}
      className="flex flex-col gap-3 rounded-lg border border-line bg-surface p-4 shadow-e1 outline-none focus-visible:ring-2 focus-visible:ring-brand-600"
    >
      <GroupCardHeader group={group} />
      <div className="flex items-center gap-1.5">
        <RoleChip role={group.role} />
        {group.status === "active" ? (
          <span className="text-caption font-semibold text-body">
            الدورة {group.currentCycle} من {group.totalCycles}
          </span>
        ) : (
          <GroupStatusChip status={group.status} />
        )}
      </div>

      {group.currentTurn && (
        <div className="flex items-center justify-between gap-3 rounded-[12px] bg-surface-2 px-3 py-2.5">
          <div className="flex flex-col">
            <span className="text-caption text-muted">دور مين المرة دي؟</span>
            <span className="text-body-sm font-semibold text-ink">
              اسم {group.currentTurn.slotNumber} · {ownersText(group.currentTurn.owners)}
            </span>
          </div>
          <span className="text-caption text-muted">{formatDayMonth(group.currentTurn.dueOn)}</span>
        </div>
      )}

      {group.myShares.length > 0 && (
        <div className="flex flex-col gap-2">
          <span className="text-caption font-semibold text-muted">نصيبك</span>
          {group.myShares.map((share) => (
            <div key={share.slotNumber} className="flex items-center justify-between gap-3">
              <span className="text-body-sm text-body">
                اسم {share.slotNumber}{" "}
                <span className="tabular font-semibold text-ink">{formatEGP(share.amount)}</span>
                {share.coOwners.length > 0 && (
                  <span className="text-muted"> مع {ownersText(share.coOwners)}</span>
                )}
              </span>
              {share.payoutDate && (
                <span className="shrink-0 rounded-full bg-brand-50 px-2.5 py-0.5 text-caption font-semibold text-brand-700">
                  دورك {formatDayMonth(share.payoutDate)}
                </span>
              )}
            </div>
          ))}
        </div>
      )}
    </Link>
  );
}
