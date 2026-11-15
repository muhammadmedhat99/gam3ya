import type { Metadata } from "next";
import { PageHeader } from "@/components/layout/page-header";
import { CloseIcon } from "@/components/ui/icons";
import { CreateGroupWizard } from "@/features/groups/create-group-wizard";
import { requireUser } from "@/server/auth/dal";

export const metadata: Metadata = { title: "جمعية جديدة · جمعيتي" };

export default async function NewGroupPage() {
  await requireUser();
  return (
    <>
      <PageHeader title="جمعية جديدة" backHref="/groups" backLabel="اقفل" backIcon={<CloseIcon size={22} />} />
      <CreateGroupWizard />
    </>
  );
}
