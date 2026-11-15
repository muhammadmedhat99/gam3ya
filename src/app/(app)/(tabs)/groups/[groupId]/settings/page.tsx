import type { Metadata } from "next";
import { CheckIcon } from "@/components/ui/icons";
import { Notice } from "@/components/ui/notice";
import { todayInCairo } from "@/lib/dates";
import { buildSchedule } from "@/lib/schedule";
import { CompleteGroup } from "@/features/settings/complete-group";
import { RolesSection } from "@/features/settings/roles-section";
import { SettingsForm } from "@/features/settings/settings-form";
import { getGroupRoles, requireGroupManager } from "@/server/services/group-detail";

export const metadata: Metadata = { title: "الإعدادات · جمعيتي" };

/** Owner/admin only. */
export default async function SettingsPage({ params }: PageProps<"/groups/[groupId]/settings">) {
  const { groupId } = await params;
  const ctx = await requireGroupManager(groupId);
  const { group } = ctx;
  const { roles, candidates } = await getGroupRoles(ctx);

  const schedule = buildSchedule({
    startDate: ctx.startDate,
    frequency: group.frequency,
    dueDay: ctx.dueDay,
    cycles: group.slotCount,
  });
  const lastStarted = (schedule.at(-1)?.startsOn ?? "9999-12-31") <= todayInCairo();
  const closed = group.status === "completed" || group.status === "cancelled";

  return (
    <main className="flex flex-col gap-6 px-4 pt-4 pb-8">
      {group.status === "completed" && (
        <Notice tone="accent" title="الجمعية خلصت" icon={<CheckIcon />}>
          لسه تقدر تسجّل دفعات متأخرة أو قبض من تاب التحصيل والقبض.
        </Notice>
      )}

      {!closed && (
        <section aria-labelledby="details" className="flex flex-col gap-3">
          <h2 id="details" className="text-title-3 text-ink">
            بيانات الجمعية
          </h2>
          <SettingsForm
            groupId={groupId}
            isDraft={group.status === "draft"}
            initial={{
              name: group.name,
              slotAmount: group.slotAmount,
              slotCount: group.slotCount,
              frequency: group.frequency,
              startDate: ctx.startDate,
              dueDay: ctx.dueDay,
            }}
          />
        </section>
      )}

      <RolesSection groupId={groupId} roles={roles} candidates={candidates} isOwner={group.role === "owner"} />

      {group.status === "active" && <CompleteGroup groupId={groupId} canComplete={lastStarted} />}
    </main>
  );
}
