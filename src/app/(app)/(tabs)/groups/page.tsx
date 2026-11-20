import type { Metadata } from "next";
import Link from "next/link";
import { PageHeader } from "@/components/layout/page-header";
import { CoinsIcon, PlusIcon } from "@/components/ui/icons";
import { EmptyState } from "@/components/ui/states";
import { groupsLabel } from "@/lib/arabic";
import { GroupListCard } from "@/features/groups/group-card";
import { requireUser } from "@/server/auth/dal";
import { listMyGroups } from "@/server/services/groups";

export const metadata: Metadata = { title: "جمعياتي · جمعيتي" };

/** Design: "8 · جمعياتي" (+ فاضية). */
export default async function GroupsPage() {
  const user = await requireUser();
  const groups = await listMyGroups(user.id);

  return (
    <>
      <PageHeader title="جمعياتي" subtitle={groups.length ? groupsLabel(groups.length) : undefined} />
      <main className="flex flex-col gap-3 px-4 pt-4 pb-24">
        {groups.length === 0 ? (
          <EmptyState
            icon={<CoinsIcon size={30} />}
            title="مفيش جمعيات لسه"
            description="الجمعيات اللي بتنظمها أو إنت عضو فيها هتظهر هنا."
          />
        ) : (
          groups.map((group) => <GroupListCard key={group.id} group={group} />)
        )}
      </main>
      <Link
        href="/groups/new"
        className="button button--primary fixed bottom-[calc(var(--nav-height)+16px)] z-20 min-h-14 rounded-[18px] px-5 text-base shadow-e2 end-[max(1rem,calc(50%-14rem+1rem))]"
      >
        <PlusIcon />
        اعمل جمعية
      </Link>
    </>
  );
}
