import type { Metadata } from "next";
import { timeAgo } from "@/lib/dates";
import { LinkRequestsView } from "@/features/requests/link-requests-view";
import { getPendingLinkRequests, requireGroupManager } from "@/server/services/group-detail";

export const metadata: Metadata = { title: "طلبات الربط · جمعيتي" };

/** Admins only (BUSINESS_RULES.md §10). */
export default async function LinkRequestsPage({ params }: PageProps<"/groups/[groupId]/requests">) {
  const { groupId } = await params;
  const ctx = await requireGroupManager(groupId);
  const requests = await getPendingLinkRequests(ctx);

  return (
    <LinkRequestsView
      groupId={groupId}
      groupName={ctx.group.name}
      requests={requests.map((r) => ({ ...r, ago: timeAgo(r.createdAt) }))}
    />
  );
}
