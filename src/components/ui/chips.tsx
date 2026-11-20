import type { ReactNode } from "react";
import type { GroupRole, GroupStatus } from "@/server/services/groups";
import { CheckIcon, CycleIcon, PencilIcon, ShieldCheckIcon, UserIcon } from "./icons";

/** Design "الشيبس والبادجات": icon + word + color, 26px pill. */
function Chip({ className, icon, children }: { className: string; icon?: ReactNode; children: ReactNode }) {
  return (
    <span
      className={`inline-flex min-h-[26px] py-0.5 items-center gap-1 rounded-full border px-[9px] text-[0.78125rem] font-semibold ${className}`}
    >
      {icon}
      {children}
    </span>
  );
}

export function RoleChip({ role }: { role: GroupRole }) {
  if (role === "owner" || role === "admin") {
    return (
      <Chip className="border-brand-600 bg-brand-600 text-white" icon={<ShieldCheckIcon size={14} />}>
        أدمن
      </Chip>
    );
  }
  if (role === "collector") {
    return (
      <Chip className="border-line bg-surface-2 text-body" icon={<UserIcon size={14} />}>
        محصّل
      </Chip>
    );
  }
  return (
    <Chip className="border-line bg-surface-2 text-body" icon={<UserIcon size={14} />}>
      عضو
    </Chip>
  );
}

export function GroupStatusChip({ status }: { status: GroupStatus }) {
  switch (status) {
    case "draft":
      return (
        <Chip className="border-dashed border-line-strong bg-transparent text-muted" icon={<PencilIcon size={14} />}>
          مسودة
        </Chip>
      );
    case "active":
      return (
        <Chip className="border-brand-100 bg-brand-50 text-brand-700" icon={<CycleIcon size={14} />}>
          شغالة
        </Chip>
      );
    case "completed":
      return (
        <Chip className="border-line bg-surface-2 text-body" icon={<CheckIcon size={14} />}>
          خلصت
        </Chip>
      );
    case "cancelled":
      return <Chip className="border-line-strong bg-transparent text-muted">اتلغت</Chip>;
  }
}
