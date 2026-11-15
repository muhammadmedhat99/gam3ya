"use client";

import { Button } from "@heroui/react";
import { AlertCircleIcon } from "@/components/ui/icons";
import { EmptyState } from "@/components/ui/states";

/** Design: "الرئيسية: خطأ". */
export default function TabsError({ reset }: { error: Error & { digest?: string }; reset: () => void }) {
  return (
    <main className="flex flex-1 flex-col justify-center px-4">
      <EmptyState
        tone="danger"
        icon={<AlertCircleIcon size={30} />}
        title="حصلت مشكلة وإحنا بنحمّل"
        description="اتأكد إن النت شغال وجرب تاني."
        action={
          <Button variant="outline" onPress={reset}>
            جرب تاني
          </Button>
        }
      />
    </main>
  );
}
