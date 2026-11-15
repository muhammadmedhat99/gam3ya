import { PageHeader } from "@/components/layout/page-header";
import { formatDate } from "@/lib/dates";
import { formatEGP } from "@/lib/money";
import { GroupTabs, type GroupTab } from "@/features/groups/group-tabs";
import { requireGroupAccess } from "@/server/services/group-detail";

/** Design "صفحة الجمعية": app bar + tabs. Members get fewer tabs than admins. */
export default async function GroupLayout({ children, params }: LayoutProps<"/groups/[groupId]">) {
  const { groupId } = await params;
  const { group, startDate, ownerName } = await requireGroupAccess(groupId);

  const subtitle = !group.isManager
    ? `الأدمن: ${ownerName}`
    : group.status === "draft"
      ? `مسودة · تبدأ ${formatDate(startDate)}`
      : `الدورة ${group.currentCycle} من ${group.totalCycles} · ${formatEGP(group.slotAmount)} × ${group.slotCount}`;

  // Collections are admin/collector-only (BUSINESS_RULES.md §9) and exist once the group started.
  const collection: GroupTab[] =
    group.canCollect && group.status !== "draft" ? [{ segment: "collection", label: "التحصيل" }] : [];

  // Payouts: owner/admin only, once started.
  const payouts: GroupTab[] =
    group.isManager && group.status !== "draft" ? [{ segment: "payouts", label: "القبض" }] : [];

  const tabs: GroupTab[] = group.isManager
    ? [
        { segment: "", label: "نظرة عامة" },
        ...collection,
        ...payouts,
        { segment: "names", label: "الأسامي" },
        { segment: "members", label: "الأعضاء" },
        { segment: "order", label: "الأدوار" },
        { segment: "settings", label: "الإعدادات" },
      ]
    : [
        { segment: "", label: "نظرة عامة" },
        ...collection,
        { segment: "members", label: "الأعضاء" },
        { segment: "order", label: "الأدوار" },
      ];

  return (
    <>
      <PageHeader title={group.name} subtitle={subtitle} backHref="/groups" />
      <GroupTabs groupId={group.id} tabs={tabs} />
      {children}
    </>
  );
}
