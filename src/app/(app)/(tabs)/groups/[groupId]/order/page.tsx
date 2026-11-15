import type { Metadata } from "next";
import { PayoutList } from "@/features/groups/payout-list";
import { ReorderList } from "@/features/order/reorder-list";
import { getGroupSlots, requireGroupAccess } from "@/server/services/group-detail";

export const metadata: Metadata = { title: "الأدوار · جمعيتي" };

/** Admins reorder; members see the same order read-only. */
export default async function OrderPage({ params }: PageProps<"/groups/[groupId]/order">) {
  const { groupId } = await params;
  const ctx = await requireGroupAccess(groupId);
  const slots = await getGroupSlots(ctx);
  const { group } = ctx;
  const canReorder = group.isManager && (group.status === "draft" || group.status === "active");

  if (!canReorder) {
    return (
      <main className="flex flex-col gap-3 px-4 pt-4 pb-6">
        <p className="text-body-sm text-muted">ده ترتيب القبض اللي الأدمن حطه. كل اسم بيقبض مرة واحدة.</p>
        <PayoutList slots={slots} currentCycle={group.currentCycle} />
      </main>
    );
  }

  return (
    <ReorderList
      // remount after a save so the "initial" order is the saved one
      key={slots.map((s) => s.id).join(",")}
      groupId={groupId}
      slots={slots}
      currentCycle={group.currentCycle}
      schedule={{ startDate: ctx.startDate, frequency: group.frequency, dueDay: ctx.dueDay }}
    />
  );
}
