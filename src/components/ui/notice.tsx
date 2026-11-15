import { Alert } from "@heroui/react";
import type { ReactNode } from "react";
import { AlertCircleIcon } from "./icons";

type Tone = "danger" | "accent" | "warning";

const toneColor: Record<Tone, string> = {
  danger: "text-danger",
  accent: "text-brand-700",
  warning: "text-warning",
};

/** Design "تنبيه": icon + short title + one sentence. */
export function Notice({
  tone = "danger",
  title,
  children,
  icon,
}: {
  tone?: Tone;
  title: string;
  children?: ReactNode;
  icon?: ReactNode;
}) {
  return (
    <Alert status={tone} role={tone === "danger" ? "alert" : "status"} className="shrink-0">
      <Alert.Indicator className={`pt-0.5 ${toneColor[tone]}`}>
        {icon ?? <AlertCircleIcon />}
      </Alert.Indicator>
      <Alert.Content className="gap-1">
        <Alert.Title className={toneColor[tone]}>{title}</Alert.Title>
        {children && <Alert.Description>{children}</Alert.Description>}
      </Alert.Content>
    </Alert>
  );
}
