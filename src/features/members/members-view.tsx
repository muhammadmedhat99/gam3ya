"use client";

import { Button } from "@heroui/react";
import Link from "next/link";
import { useState } from "react";
import { PlusIcon, UserIcon } from "@/components/ui/icons";
import { EmptyState } from "@/components/ui/states";
import { formatEgyptPhone } from "@/lib/phone";
import type { MemberRow, RegistrationState } from "@/server/services/group-detail";
import { AddMemberSheet } from "./add-member-sheet";

const REG_LABEL: Record<RegistrationState, string> = {
  linked: "مسجل في التطبيق",
  pending: "مستني موافقة",
  unregistered: "مش مسجل",
};

const REG_STYLE: Record<RegistrationState, string> = {
  linked: "border-brand-100 bg-brand-50 text-brand-700",
  pending: "border-warning-line bg-warning-soft text-warning",
  unregistered: "border-line-strong bg-transparent text-muted",
};

type Filter = "all" | RegistrationState;

/** Design "12 · الأعضاء" (+ فاضية). Phones and registration state are for admins only. */
export function MembersView({
  groupId,
  members,
  isManager,
  canAdd,
  pendingRequests,
}: {
  groupId: string;
  members: MemberRow[];
  isManager: boolean;
  canAdd: boolean;
  pendingRequests: number;
}) {
  const [filter, setFilter] = useState<Filter>("all");
  const [adding, setAdding] = useState(false);

  const counts = {
    all: members.length,
    linked: members.filter((m) => m.registration === "linked").length,
    pending: members.filter((m) => m.registration === "pending").length,
    unregistered: members.filter((m) => m.registration === "unregistered").length,
  };
  const shown = filter === "all" ? members : members.filter((m) => m.registration === filter);
  const filters: { key: Filter; label: string }[] = [
    { key: "all", label: "الكل" },
    { key: "linked", label: "مسجل" },
    { key: "pending", label: "مستني موافقة" },
    { key: "unregistered", label: "مش مسجل" },
  ];

  return (
    <main className="flex flex-col gap-3 px-4 pt-4 pb-24">
      {isManager && pendingRequests > 0 && (
        <div className="flex items-center gap-3 rounded-[14px] border border-brand-100 bg-brand-50 px-4 py-2">
          <p className="flex-1 text-body-sm font-semibold text-brand-700">
            عندك {pendingRequests} طلبات ربط مستنية
          </p>
          <Link href={`/groups/${groupId}/requests`} className="button button--ghost">
            راجع
          </Link>
        </div>
      )}

      {members.length === 0 ? (
        <EmptyState
          icon={<UserIcon size={30} />}
          title="لسه مفيش أعضاء"
          description={
            canAdd ? "ضيف الناس بالاسم ورقم الموبايل. مش لازم يكون عندهم حساب في التطبيق دلوقتي." : undefined
          }
          action={
            canAdd ? (
              <Button size="lg" onPress={() => setAdding(true)}>
                <PlusIcon />
                ضيف عضو
              </Button>
            ) : undefined
          }
        />
      ) : (
        <>
          {isManager && (
            <div role="group" aria-label="فلتر الأعضاء" className="-mx-4 flex gap-2 overflow-x-auto px-4 [scrollbar-width:none]">
              {filters.map((f) => (
                <button
                  key={f.key}
                  type="button"
                  aria-pressed={filter === f.key}
                  onClick={() => setFilter(f.key)}
                  className={`flex h-11 shrink-0 items-center gap-1.5 rounded-full border-[1.5px] px-4 text-body-sm font-semibold ${
                    filter === f.key ? "border-ink bg-ink text-white" : "border-line-strong bg-surface text-body"
                  }`}
                >
                  {f.label}
                  <span
                    className={`rounded-full px-1.5 text-micro font-bold ${
                      filter === f.key ? "bg-white/20" : "bg-surface-2"
                    }`}
                  >
                    {counts[f.key]}
                  </span>
                </button>
              ))}
            </div>
          )}

          <ul className="flex flex-col divide-y divide-line rounded-lg border border-line bg-surface shadow-e1">
            {shown.map((m) => (
              <li key={m.id} className="flex items-center gap-3 px-4 py-3">
                <span className="flex size-10 shrink-0 items-center justify-center rounded-full bg-surface-2 text-title-3 text-body">
                  {m.displayName.charAt(0)}
                </span>
                <div className="flex min-w-0 flex-1 flex-col gap-0.5">
                  <span className="truncate text-body-sm font-semibold text-ink">
                    {m.displayName}
                    {m.isMe && <span className="ms-1.5 text-caption font-normal text-muted">(إنت)</span>}
                  </span>
                  <span className="text-caption text-muted">
                    {m.phone && (
                      <span dir="ltr" className="tabular">
                        {formatEgyptPhone(m.phone)}
                      </span>
                    )}
                    {m.phone && m.slotNumbers.length > 0 && " · "}
                    {m.slotNumbers.map((n) => `اسم ${n}`).join(" · ")}
                    {!m.phone && m.slotNumbers.length === 0 && "لسه ملهوش حصة"}
                  </span>
                </div>
                {m.registration && (
                  <span
                    className={`shrink-0 rounded-full border px-2 text-[12.5px] leading-6 font-semibold ${REG_STYLE[m.registration]}`}
                  >
                    {REG_LABEL[m.registration]}
                  </span>
                )}
              </li>
            ))}
            {shown.length === 0 && <li className="px-4 py-6 text-center text-body-sm text-muted">مفيش حد هنا</li>}
          </ul>
        </>
      )}

      {canAdd && members.length > 0 && (
        <Button
          size="lg"
          onPress={() => setAdding(true)}
          className="fixed bottom-24 z-20 h-14 rounded-[18px] shadow-e2 end-[max(1rem,calc(50%-14rem+1rem))]"
        >
          <PlusIcon />
          ضيف عضو
        </Button>
      )}

      {canAdd && <AddMemberSheet groupId={groupId} isOpen={adding} onOpenChange={setAdding} />}
    </main>
  );
}
