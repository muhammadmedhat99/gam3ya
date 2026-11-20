"use client";

import { Button } from "@heroui/react";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { BottomSheet } from "@/components/ui/bottom-sheet";
import { CloseIcon, PlusIcon, ShieldCheckIcon, UserIcon } from "@/components/ui/icons";
import { Notice } from "@/components/ui/notice";
import { removeGroupRoleAction, setGroupRoleAction } from "@/server/actions/group-settings";
import type { RoleRow } from "@/server/services/group-detail";

const ROLE_LABEL = { owner: "صاحب الجمعية", admin: "أدمن", collector: "محصّل" } as const;
const ROLE_HINT = {
  admin: "يقدر يعمل كل حاجة: الأعضاء والأسامي والتحصيل والقبض.",
  collector: "يشوف التحصيل ويسجّل الدفعات بس. مش بيقدر يصحّح ولا يسجّل قبض.",
} as const;

/** Owner manages admins; owners and admins manage collectors (enforced in the database too). */
export function RolesSection({
  groupId,
  roles,
  candidates,
  isOwner,
}: {
  groupId: string;
  roles: RoleRow[];
  candidates: { userId: string; name: string }[];
  isOwner: boolean;
}) {
  const router = useRouter();
  const [adding, setAdding] = useState(false);
  const [userId, setUserId] = useState("");
  const [role, setRole] = useState<"admin" | "collector">("collector");
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState<string | null>(null);

  async function add() {
    setPending("add");
    setError(null);
    const result = await setGroupRoleAction({ groupId, userId, role });
    setPending(null);
    if ("ok" in result) {
      setAdding(false);
      setUserId("");
      router.refresh();
    } else setError(result.error ?? "حصلت مشكلة.");
  }

  async function remove(target: string) {
    setPending(target);
    setError(null);
    const result = await removeGroupRoleAction({ groupId, userId: target });
    setPending(null);
    if ("ok" in result) router.refresh();
    else setError(result.error ?? "حصلت مشكلة.");
  }

  return (
    <section aria-labelledby="roles" className="flex flex-col gap-3">
      <h2 id="roles" className="text-title-3 text-ink">
        الأدمن والمحصّلين
      </h2>
      {error && !adding && <Notice title={error} />}
      <ul className="flex flex-col divide-y divide-line rounded-lg border border-line bg-surface shadow-e1">
        {roles.map((r) => {
          const canRemove = r.role === "collector" || (r.role === "admin" && isOwner);
          return (
            <li key={r.userId} className="flex flex-wrap items-center gap-3 px-4 py-3">
              <div className="flex min-w-[min(13rem,100%)] flex-1 items-center gap-3">
                <span className="flex size-10 shrink-0 items-center justify-center rounded-full bg-surface-2 text-body">
                  {r.role === "collector" ? <UserIcon /> : <ShieldCheckIcon />}
                </span>
                <div className="flex min-w-0 flex-1 flex-col">
                  <span className="text-body-sm font-semibold text-ink">
                    {r.name}
                    {r.isMe && <span className="text-caption font-normal text-muted"> (إنت)</span>}
                  </span>
                  <span className="text-caption text-muted">{ROLE_LABEL[r.role]}</span>
                </div>
              </div>
              {canRemove && (
                <Button
                  variant="ghost"
                  isIconOnly
                  aria-label={`شيل ${r.name} من ${ROLE_LABEL[r.role]}`}
                  isPending={pending === r.userId}
                  onPress={() => remove(r.userId)}
                  className="text-muted"
                >
                  <CloseIcon />
                </Button>
              )}
            </li>
          );
        })}
      </ul>

      <Button variant="secondary" onPress={() => setAdding(true)} isDisabled={candidates.length === 0}>
        <PlusIcon />
        ضيف أدمن أو محصّل
      </Button>
      {candidates.length === 0 && (
        <p className="text-caption text-muted">الدور بيتدّى لعضو عنده حساب مربوط بالجمعية. مفيش حد متاح دلوقتي.</p>
      )}

      {adding && (
        <BottomSheet
          isOpen
          onOpenChange={(o) => !o && pending === null && setAdding(false)}
          title="ضيف أدمن أو محصّل"
          footer={
            <Button size="lg" fullWidth isDisabled={!userId} isPending={pending === "add"} onPress={add}>
              احفظ
            </Button>
          }
        >
          {error && <Notice title={error} />}
          <label className="flex flex-col gap-1.5">
            <span className="text-label text-ink">العضو</span>
            <select
              value={userId}
              onChange={(e) => setUserId(e.target.value)}
              className="min-h-13 py-2 rounded-[12px] border-[1.5px] border-line-strong bg-surface px-3.5 text-base text-ink"
            >
              <option value="">اختار عضو…</option>
              {candidates.map((c) => (
                <option key={c.userId} value={c.userId}>
                  {c.name}
                </option>
              ))}
            </select>
          </label>
          <fieldset className="flex flex-col gap-2">
            <legend className="mb-1.5 text-label text-ink">الدور</legend>
            {(isOwner ? (["collector", "admin"] as const) : (["collector"] as const)).map((r) => (
              <label
                key={r}
                className={`flex cursor-pointer items-start gap-3 rounded-[14px] border-[1.5px] p-3.5 has-focus-visible:ring-2 has-focus-visible:ring-brand-600 ${
                  role === r ? "border-brand-600 bg-brand-50" : "border-line-strong bg-surface"
                }`}
              >
                <input
                  type="radio"
                  name="role"
                  checked={role === r}
                  onChange={() => setRole(r)}
                  className="mt-1 size-4 accent-brand-600"
                />
                <span className="flex flex-col">
                  <span className="text-body-sm font-semibold text-ink">{ROLE_LABEL[r]}</span>
                  <span className="text-caption text-muted">{ROLE_HINT[r]}</span>
                </span>
              </label>
            ))}
            {!isOwner && <p className="text-caption text-muted">صاحب الجمعية بس هو اللي يضيف أدمن.</p>}
          </fieldset>
        </BottomSheet>
      )}
    </section>
  );
}
