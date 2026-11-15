import { PageSkeleton } from "@/components/ui/states";

/** Switching tabs inside an association: the header and tabs stay, the content shimmers. */
export default function Loading() {
  return <PageSkeleton header={false} hero cards={2} />;
}
