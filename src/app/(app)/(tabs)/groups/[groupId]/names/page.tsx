import type { Metadata } from "next";
import { SlotsView } from "@/features/slots/slots-view";
import { getGroupMembers, getGroupSlots, requireGroupManager } from "@/server/services/group-detail";

export const metadata: Metadata = { title: "الأسامي · جمعيتي" };

/** Admins only: members see shares on the overview's payout order instead. */
export default async function NamesPage({ params }: PageProps<"/groups/[groupId]/names">) {
  const { groupId } = await params;
  const ctx = await requireGroupManager(groupId);
  const [slots, members] = await Promise.all([getGroupSlots(ctx), getGroupMembers(ctx)]);

  return (
    <SlotsView
      groupId={groupId}
      slots={slots}
      slotAmount={ctx.group.slotAmount}
      members={members.map((m) => ({ id: m.id, name: m.displayName }))}
      editable={ctx.group.status === "draft"}
    />
  );
}
