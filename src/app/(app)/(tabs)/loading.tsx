import { CardSkeleton, Skeleton } from "@/components/ui/states";

/** Design: "الرئيسية: بتحمّل". */
export default function Loading() {
  return (
    <main aria-busy="true" aria-label="بيحمّل" className="flex flex-col gap-5 px-4 pt-5">
      <div className="flex flex-col gap-2">
        <Skeleton className="h-4 w-32" />
        <Skeleton className="h-7 w-40" />
      </div>
      <CardSkeleton />
      <CardSkeleton />
    </main>
  );
}
