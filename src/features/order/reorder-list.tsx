"use client";

import {
  closestCenter,
  DndContext,
  KeyboardSensor,
  PointerSensor,
  useSensor,
  useSensors,
  type Announcements,
  type DragEndEvent,
} from "@dnd-kit/core";
import { restrictToParentElement, restrictToVerticalAxis } from "@dnd-kit/modifiers";
import {
  arrayMove,
  SortableContext,
  sortableKeyboardCoordinates,
  useSortable,
  verticalListSortingStrategy,
} from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import { Button } from "@heroui/react";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { LockIcon } from "@/components/ui/icons";
import { Notice } from "@/components/ui/notice";
import { formatDayMonth } from "@/lib/dates";
import { buildSchedule, type Frequency } from "@/lib/schedule";
import { reorderPayoutsAction } from "@/server/actions/group-setup";
import type { SlotRow } from "@/server/services/group-detail";
import { ownersSummary } from "@/features/groups/payout-list";

const ArrowUp = () => (
  <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
    <path d="M12 19V5M6 11l6-6 6 6" />
  </svg>
);
const ArrowDown = () => (
  <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
    <path d="M12 5v14M6 13l6 6 6-6" />
  </svg>
);
const GripIcon = () => (
  <svg width="20" height="20" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
    <circle cx="9" cy="6" r="1.6" />
    <circle cx="15" cy="6" r="1.6" />
    <circle cx="9" cy="12" r="1.6" />
    <circle cx="15" cy="12" r="1.6" />
    <circle cx="9" cy="18" r="1.6" />
    <circle cx="15" cy="18" r="1.6" />
  </svg>
);

interface RowProps {
  slot: SlotRow;
  index: number;
  total: number;
  locked: boolean;
  isCurrent: boolean;
  moved: boolean;
  dueOn: string;
  lockedCount: number;
  onMove: (index: number, delta: -1 | 1) => void;
}

function SortableRow({ slot, index, total, locked, isCurrent, moved, dueOn, lockedCount, onMove }: RowProps) {
  const { attributes, listeners, setNodeRef, setActivatorNodeRef, transform, transition, isDragging } = useSortable({
    id: slot.id,
    disabled: locked,
  });

  return (
    <li
      ref={setNodeRef}
      style={{ transform: CSS.Transform.toString(transform), transition }}
      className={`relative flex min-h-[62px] items-center gap-2 rounded-[14px] border p-2 ${
        isDragging
          ? "z-10 border-brand-600 bg-surface shadow-e2"
          : locked
            ? "border-line bg-surface-2"
            : moved
              ? "border-brand-200 bg-brand-50"
              : "border-line bg-surface"
      }`}
    >
      {locked ? (
        <span aria-label="متقفل" className="flex h-11 w-9 shrink-0 items-center justify-center text-muted">
          <LockIcon />
        </span>
      ) : (
        <button
          type="button"
          ref={setActivatorNodeRef}
          {...attributes}
          {...listeners}
          aria-label={`اسحب عشان تنقل ${ownersSummary(slot)}`}
          className="flex h-11 w-9 shrink-0 cursor-grab touch-none items-center justify-center rounded-[10px] text-muted active:cursor-grabbing focus-visible:ring-2 focus-visible:ring-brand-600 focus-visible:outline-none"
        >
          <GripIcon />
        </button>
      )}
      <span
        className={`flex size-[30px] shrink-0 items-center justify-center rounded-[9px] text-body-sm font-bold ${
          isCurrent
            ? "bg-brand-600 text-white"
            : locked
              ? "bg-sunken text-muted"
              : moved
                ? "bg-brand-50 text-brand-700"
                : "bg-surface-2 text-body"
        }`}
      >
        {index + 1}
      </span>
      <div className="flex min-w-0 flex-1 flex-col gap-0.5">
        <div className="flex flex-wrap items-center gap-1.5">
          <span className={`text-body-sm font-semibold ${locked && !isCurrent ? "text-muted" : "text-ink"}`}>
            {ownersSummary(slot)}
          </span>
          {isCurrent && (
            <span className="rounded-full bg-brand-600 px-2 text-[12.5px] leading-[22px] font-semibold text-white">
              الدورة دي
            </span>
          )}
          {moved && !isDragging && (
            <span className="rounded-full border border-brand-100 bg-brand-50 px-2 text-[12.5px] leading-[22px] font-semibold text-brand-700">
              اتنقل
            </span>
          )}
        </div>
        <span className="truncate text-caption text-muted">
          اسم {index + 1} · يقبض {formatDayMonth(dueOn)}
        </span>
      </div>
      {!locked && (
        <div className="flex shrink-0">
          <Button
            variant="ghost"
            isIconOnly
            aria-label={`طلّع ${ownersSummary(slot)} دور لفوق`}
            isDisabled={index <= lockedCount}
            onPress={() => onMove(index, -1)}
          >
            <ArrowUp />
          </Button>
          <Button
            variant="ghost"
            isIconOnly
            aria-label={`نزّل ${ownersSummary(slot)} دور لتحت`}
            isDisabled={index === total - 1}
            onPress={() => onMove(index, 1)}
          >
            <ArrowDown />
          </Button>
        </div>
      )}
    </li>
  );
}

/**
 * Design "16 · ترتيب القبض": names stay 1..N (name N = turn N); the PEOPLE move.
 * Drag a row by its handle or use the arrows; saving renumbers slots in the database.
 * Turns whose cycle already started are locked (the database enforces it too).
 */
export function ReorderList({
  groupId,
  slots,
  currentCycle,
  schedule,
}: {
  groupId: string;
  slots: SlotRow[];
  currentCycle: number;
  schedule: { startDate: string; frequency: Frequency; dueDay: number };
}) {
  const router = useRouter();
  const initial = [...slots].sort((a, b) => a.payoutOrder - b.payoutOrder);
  const [order, setOrder] = useState(initial);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [announce, setAnnounce] = useState("");

  const dates = buildSchedule({ ...schedule, cycles: order.length });
  const lockedCount = currentCycle; // positions 1..currentCycle are fixed
  const dirty = order.some((s, i) => s.id !== initial[i].id);
  const nameOf = (id: string | number) => {
    const slot = order.find((s) => s.id === id);
    return slot ? ownersSummary(slot) : "";
  };

  const sensors = useSensors(
    // Drag starts only from the handle (touch-action: none), so the page still scrolls normally.
    useSensor(PointerSensor, { activationConstraint: { distance: 4 } }),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates }),
  );

  const announcements: Announcements = {
    onDragStart: ({ active }) => `مسكت ${nameOf(active.id)}`,
    onDragOver: ({ active, over }) =>
      over ? `${nameOf(active.id)} فوق اسم ${order.findIndex((s) => s.id === over.id) + 1}` : undefined,
    onDragEnd: ({ active, over }) =>
      over ? `${nameOf(active.id)} بقى في اسم ${order.findIndex((s) => s.id === over.id) + 1}` : undefined,
    onDragCancel: ({ active }) => `اتلغى نقل ${nameOf(active.id)}`,
  };

  function move(index: number, delta: -1 | 1) {
    const target = index + delta;
    if (target < lockedCount || target >= order.length) return;
    const next = arrayMove(order, index, target);
    setOrder(next);
    setAnnounce(`${ownersSummary(next[target])} بقى في اسم ${target + 1}`);
  }

  function onDragEnd({ active, over }: DragEndEvent) {
    if (!over || active.id === over.id) return;
    const from = order.findIndex((s) => s.id === active.id);
    // Never drop into the locked (already started) turns.
    const to = Math.max(lockedCount, order.findIndex((s) => s.id === over.id));
    if (from < lockedCount || from === to) return;
    setOrder(arrayMove(order, from, to));
  }

  async function save() {
    setSaving(true);
    setError(null);
    const result = await reorderPayoutsAction({ groupId, slotIds: order.map((s) => s.id) });
    setSaving(false);
    if ("ok" in result) router.refresh();
    else setError(result.error ?? "حصلت مشكلة. جرب تاني.");
  }

  return (
    <main className="flex flex-col gap-3 px-4 pt-4 pb-40">
      <p className="text-body-sm text-muted">
        الأسامي ثابتة بالترتيب (اسم 1 بيقبض الأول). اسحب الشخص من النقط اللي على اليمين لاسم تاني، أو استخدم
        الأسهم.
        {lockedCount > 0 && " الأدوار اللي فاتت والدورة الحالية متقفلة."}
      </p>
      {error && <Notice title={error} />}
      <p className="sr-only" aria-live="polite">
        {announce}
      </p>

      <DndContext
        sensors={sensors}
        collisionDetection={closestCenter}
        modifiers={[restrictToVerticalAxis, restrictToParentElement]}
        onDragEnd={onDragEnd}
        accessibility={{
          announcements,
          screenReaderInstructions: {
            draggable: "عشان تنقل الاسم: دوس مسافة، حرّكه بالأسهم، ودوس مسافة تاني عشان تسيبه، أو Escape عشان تلغي.",
          },
        }}
      >
        <SortableContext items={order.map((s) => s.id)} strategy={verticalListSortingStrategy}>
          <ol className="flex flex-col gap-2">
            {order.map((slot, i) => (
              <SortableRow
                key={slot.id}
                slot={slot}
                index={i}
                total={order.length}
                locked={i < lockedCount}
                isCurrent={i + 1 === currentCycle}
                moved={slot.id !== initial[i].id}
                dueOn={dates[i].dueOn}
                lockedCount={lockedCount}
                onMove={move}
              />
            ))}
          </ol>
        </SortableContext>
      </DndContext>

      {dirty && (
        <div className="fixed inset-x-0 bottom-(--nav-height) z-20 mx-auto flex max-w-md flex-col gap-2 border-t border-line bg-surface px-4 pt-3 pb-3 shadow-[0_-4px_16px_rgba(31,29,26,0.05)]">
          <p className="text-caption font-semibold text-warning">عندك تغييرات مش محفوظة</p>
          <div className="flex gap-2.5">
            <Button variant="outline" className="flex-1" onPress={() => setOrder(initial)}>
              تراجع
            </Button>
            <Button className="flex-[2]" isPending={saving} onPress={save}>
              احفظ الترتيب
            </Button>
          </div>
        </div>
      )}
    </main>
  );
}
