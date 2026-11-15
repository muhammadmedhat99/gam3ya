import { PageSkeleton } from "@/components/ui/states";

/** جمعياتي + opening an association (until its header and tabs are ready). */
export default function Loading() {
  return <PageSkeleton cards={3} />;
}
