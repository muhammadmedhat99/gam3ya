import type { Metadata } from "next";
import { MembersView } from "@/features/members/members-view";
import {
  countPendingLinkRequests,
  getGroupMembers,
  requireGroupAccess,
} from "@/server/services/group-detail";

export const metadata: Metadata = { title: "الأعضاء · جمعيتي" };

export default async function MembersPage({ params }: PageProps<"/groups/[groupId]/members">) {
  const { groupId } = await params;
  const ctx = await requireGroupAccess(groupId);
  const [members, pending] = await Promise.all([getGroupMembers(ctx), countPendingLinkRequests(ctx)]);
  const open = ctx.group.status === "draft" || ctx.group.status === "active";

  return (
    <MembersView
      groupId={groupId}
      members={members}
      isManager={ctx.group.isManager}
      canAdd={ctx.group.isManager && open}
      pendingRequests={pending}
    />
  );
}
