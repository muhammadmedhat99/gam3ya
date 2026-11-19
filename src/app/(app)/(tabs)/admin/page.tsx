import type { Metadata } from "next";
import Link from "next/link";
import { PageHeader } from "@/components/layout/page-header";
import { Notice } from "@/components/ui/notice";
import { formatDate, timeAgo } from "@/lib/dates";
import { formatEgyptPhone, normalizeEgyptPhone } from "@/lib/phone";
import { AdminUserActions } from "@/features/admin/user-actions";
import { requireSuperAdmin } from "@/server/auth/dal";
import { findUserByPhone, platformStats, recentActivity } from "@/server/services/admin";

export const metadata: Metadata = { title: "لوحة صاحب التطبيق · جمعيتي" };

const ROLE = { owner: "صاحب", admin: "أدمن", collector: "محصّل", member: "عضو" } as Record<string, string>;

const ACTION: Record<string, string> = {
  "user.password_reset": "reset كلمة سر",
  "user.account_recovered": "استرجاع حساب",
  "user.password_changed": "غيّر كلمة السر",
  "user.blocked": "وقّف حساب",
  "user.unblocked": "شغّل حساب",
  "user.super_admin_bootstrapped": "إنشاء حساب صاحب التطبيق",
  "group.created": "عمل جمعية",
  "group.activated": "بدأ جمعية",
  "group.completed": "جمعية خلصت",
  "group.deleted": "مسح جمعية",
  "group.settings_changed": "عدّل إعدادات",
  "group.payout_order_changed": "غيّر ترتيب القبض",
  "member.added": "ضاف عضو",
  "link_request.created": "طلب ربط",
  "link_request.approved": "وافق على ربط",
  "link_request.rejected": "رفض ربط",
  "slot.allocations_changed": "عدّل تقسيم اسم",
  "payment.recorded": "سجّل دفعة",
  "payment.reversed": "صحّح دفعة",
  "payout.opened": "فتح قبض دورة",
  "payout.recorded": "سجّل قبض",
  "payout.reversed": "صحّح قبض",
  "role.set": "إدّى دور",
  "role.removed": "شال دور",
};

/** Super admin only (404 for everyone else). */
export default async function AdminPage({ searchParams }: PageProps<"/admin">) {
  await requireSuperAdmin();
  const { phone: rawPhone } = await searchParams;
  const phoneInput = typeof rawPhone === "string" ? rawPhone : "";
  const phone = phoneInput ? normalizeEgyptPhone(phoneInput) : null;

  const [stats, activity, found] = await Promise.all([
    platformStats(),
    recentActivity(),
    phone ? findUserByPhone(phone) : Promise.resolve(null),
  ]);

  return (
    <>
      <PageHeader title="لوحة صاحب التطبيق" backHref="/profile" />
      <main className="flex flex-col gap-5 px-4 pt-4 pb-8">
        <section className="grid grid-cols-3 gap-2">
          {[
            ["المستخدمين", stats.users],
            ["جمعيات شغالة", stats.groups.active],
            ["مسودات", stats.groups.draft],
            ["خلصت", stats.groups.completed],
            ["حسابات موقوفة", stats.blocked],
          ].map(([label, value]) => (
            <div key={label} className="flex flex-col rounded-[14px] border border-line bg-surface p-3 shadow-e1">
              <span className="tabular text-amount-md text-ink">{value}</span>
              <span className="text-caption text-muted">{label}</span>
            </div>
          ))}
        </section>

        <section aria-labelledby="find" className="flex flex-col gap-3">
          <h2 id="find" className="text-title-3 text-ink">
            دوّر على مستخدم
          </h2>
          <form method="get" className="flex gap-2">
            <label className="sr-only" htmlFor="phone">
              رقم الموبايل
            </label>
            <input
              id="phone"
              name="phone"
              type="tel"
              inputMode="tel"
              dir="ltr"
              defaultValue={phoneInput}
              placeholder="010 1234 5678"
              className="h-13 min-w-0 flex-1 rounded-[12px] border-[1.5px] border-line-strong bg-surface px-3.5 text-right text-base text-ink"
            />
            <button type="submit" className="button button--primary h-13">
              دوّر
            </button>
          </form>

          {phoneInput && !phone && <Notice title="اكتب رقم موبايل مصري صحيح" />}
          {phone && !found && <Notice tone="accent" title="مفيش حساب بالرقم ده" />}

          {found && (
            <section className="flex flex-col gap-3 rounded-lg border border-line bg-surface p-4 shadow-e1">
              <div className="flex flex-col gap-0.5">
                <span className="text-title-3 text-ink">
                  {found.fullName}
                  {found.isSuperAdmin && <span className="text-caption text-brand-700"> · صاحب التطبيق</span>}
                </span>
                <span dir="ltr" className="tabular text-right text-body-sm text-muted">
                  {formatEgyptPhone(found.phone)}
                </span>
                {found.email && <span className="text-caption text-muted">{found.email}</span>}
              </div>
              <dl className="grid grid-cols-2 gap-2 text-body-sm">
                <div>
                  <dt className="text-caption text-muted">الحالة</dt>
                  <dd className={found.status === "blocked" ? "font-semibold text-danger" : "font-semibold text-ink"}>
                    {found.status === "blocked" ? "موقوف" : "شغال"}
                  </dd>
                </div>
                <div>
                  <dt className="text-caption text-muted">اتسجل</dt>
                  <dd className="text-ink">{formatDate(found.createdAt.slice(0, 10))}</dd>
                </div>
                {found.mustChangePassword && (
                  <div className="col-span-2">
                    <dt className="text-caption text-muted">كلمة سر مؤقتة</dt>
                    <dd className="text-warning">
                      لازم يغيّرها
                      {found.tempPasswordExpiresAt &&
                        ` · صالحة لحد ${new Intl.DateTimeFormat("ar-EG-u-nu-latn", {
                          dateStyle: "medium",
                          timeStyle: "short",
                          timeZone: "Africa/Cairo",
                        }).format(new Date(found.tempPasswordExpiresAt))}`}
                    </dd>
                  </div>
                )}
                {found.pendingRequests > 0 && (
                  <div className="col-span-2">
                    <dt className="text-caption text-muted">طلبات ربط مستنية</dt>
                    <dd className="text-ink">{found.pendingRequests}</dd>
                  </div>
                )}
              </dl>

              <div className="flex flex-col gap-1.5">
                <span className="text-caption font-semibold text-muted">الجمعيات</span>
                {found.groups.length === 0 ? (
                  <span className="text-body-sm text-muted">مش في أي جمعية</span>
                ) : (
                  <ul className="flex flex-col gap-1">
                    {found.groups.map((g) => (
                      <li key={g.id} className="flex items-center justify-between gap-2 text-body-sm">
                        <span className="text-ink">{g.name}</span>
                        <span className="rounded-full bg-surface-2 px-2 text-caption text-body">{ROLE[g.role] ?? g.role}</span>
                      </li>
                    ))}
                  </ul>
                )}
              </div>

              <AdminUserActions userId={found.id} status={found.status} isSuperAdmin={found.isSuperAdmin} />
            </section>
          )}
        </section>

        <section aria-labelledby="log" className="flex flex-col gap-2">
          <h2 id="log" className="text-title-3 text-ink">
            آخر النشاط
          </h2>
          <ul className="flex flex-col divide-y divide-line rounded-lg border border-line bg-surface shadow-e1">
            {activity.map((a) => (
              <li key={a.id} className="flex flex-col gap-0.5 px-4 py-2.5">
                <span className="text-body-sm text-ink">
                  <b>{a.actor ?? "النظام"}</b> {ACTION[a.action] ?? a.action}
                  {a.group && <span className="text-muted"> · {a.group}</span>}
                </span>
                <span className="text-caption text-muted">{timeAgo(a.createdAt)}</span>
              </li>
            ))}
            {activity.length === 0 && <li className="px-4 py-6 text-center text-body-sm text-muted">لسه مفيش نشاط</li>}
          </ul>
        </section>

        <p className="text-caption text-muted">
          الصفحة دي بتظهر لصاحب التطبيق بس. كل حاجة بتتعمل منها بتتسجل.{" "}
          <Link href="/" className="font-semibold text-brand-700">
            ارجع للرئيسية
          </Link>
        </p>
      </main>
    </>
  );
}
