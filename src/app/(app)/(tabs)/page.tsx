import Link from "next/link";
import { ChevronIcon, CoinsIcon, InfoIcon, PlusIcon } from "@/components/ui/icons";
import { Notice } from "@/components/ui/notice";
import { EmptyState } from "@/components/ui/states";
import { requestsLabel } from "@/lib/arabic";
import { formatDayMonth, formatLongDate, todayInCairo } from "@/lib/dates";
import { GroupHomeCard } from "@/features/groups/group-card";
import { requireUser } from "@/server/auth/dal";
import { adminTasks, countMyPendingLinkRequests, listMyGroups } from "@/server/services/groups";

/** Design: "الرئيسية" (عضو / أدمن / مستني موافقة / فاضية). */
export default async function HomePage() {
  const user = await requireUser();
  const [groups, pending] = await Promise.all([
    listMyGroups(user.id),
    countMyPendingLinkRequests(user.id),
  ]);
  const tasks = await adminTasks(groups);
  const firstName = user.fullName.split(" ")[0];
  const visible = groups.filter((g) => g.status !== "cancelled");

  return (
    <main className="flex flex-col gap-5 px-4 pt-5 pb-6">
      <header className="flex items-center gap-3">
        <div className="flex min-w-0 flex-1 flex-col">
          <span className="text-caption text-muted">{formatLongDate(todayInCairo())}</span>
          <h1 className="truncate text-title-1 text-ink">أهلاً يا {firstName}</h1>
        </div>
        <Link
          href="/profile"
          aria-label="حسابي"
          className="flex size-11 shrink-0 items-center justify-center rounded-full bg-brand-50 text-title-3 text-brand-700"
        >
          {firstName.charAt(0)}
        </Link>
      </header>

      {pending > 0 && (
        <Notice tone="accent" title="في جمعيات مستنية موافقة الأدمن عشان تظهرلك" icon={<InfoIcon />}>
          أول ما الأدمن يوافق هتلاقيها هنا على طول. مش محتاج تعمل حاجة دلوقتي.
        </Notice>
      )}

      {tasks.length > 0 && (
        <section aria-labelledby="todo" className="flex flex-col gap-2">
          <h2 id="todo" className="text-title-3 text-ink">
            محتاج تعمله
          </h2>
          <div className="flex flex-col divide-y divide-line rounded-lg border border-line bg-surface shadow-e1">
            {tasks.flatMap((task) => [
              task.pendingLinkRequests > 0 && (
                <Link
                  key={`${task.groupId}-requests`}
                  href={`/groups/${task.groupId}/requests`}
                  className="flex min-h-16 items-center gap-3 px-4 py-3"
                >
                  <div className="flex min-w-0 flex-1 flex-col">
                    <span className="text-body-sm font-semibold text-ink">طلبات ربط مستنية</span>
                    <span className="text-caption text-muted">
                      {task.groupName} · ناس سجلوا بأرقام إنت ضايفها
                    </span>
                  </div>
                  <span
                    aria-label={requestsLabel(task.pendingLinkRequests)}
                    className="flex min-h-7 py-0.5 min-w-7 items-center justify-center rounded-full bg-brand-600 px-2 text-caption font-bold text-white"
                  >
                    {task.pendingLinkRequests}
                  </span>
                  <ChevronIcon className="text-muted" />
                </Link>
              ),
              task.overdue > 0 && (
                <Link
                  key={`${task.groupId}-overdue`}
                  href={`/groups/${task.groupId}/collection`}
                  className="flex min-h-16 items-center gap-3 px-4 py-3"
                >
                  <div className="flex min-w-0 flex-1 flex-col">
                    <span className="text-body-sm font-semibold text-ink">
                      متأخرين في الدورة {task.currentCycle}
                    </span>
                    <span className="text-caption text-muted">
                      {task.groupName}
                      {task.dueOn && ` · آخر ميعاد كان ${formatDayMonth(task.dueOn)}`}
                    </span>
                  </div>
                  <span className="flex min-h-7 py-0.5 min-w-7 items-center justify-center rounded-full bg-overdue px-2 text-caption font-bold text-white">
                    {task.overdue}
                  </span>
                  <ChevronIcon className="text-muted" />
                </Link>
              ),
            ])}
          </div>
          <p className="text-caption text-muted">الحاجات دي باينة ليك إنت بس كأدمن</p>
        </section>
      )}

      {visible.length > 0 ? (
        <section aria-labelledby="mine" className="flex flex-col gap-3">
          <h2 id="mine" className="flex items-center gap-2 text-title-3 text-ink">
            جمعياتك
            <span className="rounded-full bg-surface-2 px-2 text-caption font-bold text-body">
              {visible.length}
            </span>
          </h2>
          {visible.map((group) => (
            <GroupHomeCard key={group.id} group={group} />
          ))}
        </section>
      ) : (
        <div className="rounded-lg border border-line bg-surface shadow-e1">
          <EmptyState
            icon={<CoinsIcon size={30} />}
            title={pending > 0 ? "لسه مفيش جمعيات ظاهرة" : "لسه معندكش جمعيات"}
            description={
              pending > 0
                ? "ولو إنت كمان بتنظّم جمعية، تقدر تعملها من هنا وتضيف الناس."
                : "اعمل جمعية جديدة وضيف الناس بالاسم والرقم، أو استنى لما حد يضيفك في جمعيته."
            }
            action={
              <Link href="/groups/new" className="button button--primary button--lg">
                <PlusIcon />
                اعمل جمعية
              </Link>
            }
          />
        </div>
      )}
    </main>
  );
}
