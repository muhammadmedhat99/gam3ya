"use client";

import { Button, Drawer } from "@heroui/react";
import type { ReactNode } from "react";
import { CloseIcon } from "./icons";

/** Design "شيت": handle, title + subtitle, close button, scrollable body, sticky footer. */
export function BottomSheet({
  isOpen,
  onOpenChange,
  title,
  subtitle,
  children,
  footer,
  isDismissable = true,
}: {
  isOpen: boolean;
  onOpenChange: (open: boolean) => void;
  title: string;
  subtitle?: string;
  children: ReactNode;
  footer?: ReactNode;
  isDismissable?: boolean;
}) {
  return (
    <Drawer isOpen={isOpen} onOpenChange={onOpenChange}>
      <Drawer.Backdrop isDismissable={isDismissable}>
        <Drawer.Content placement="bottom" className="mx-auto max-h-[94dvh] max-w-md">
          <Drawer.Dialog aria-label={title} className="flex max-h-[94dvh] flex-col">
            <Drawer.Handle />
            <Drawer.Header className="flex items-center gap-2 ps-5 pe-2 pt-2 pb-1">
              <div className="flex min-w-0 flex-1 flex-col">
                <Drawer.Heading className="text-title-2 text-ink">{title}</Drawer.Heading>
                {subtitle && <p className="text-caption text-muted">{subtitle}</p>}
              </div>
              <Button
                variant="ghost"
                isIconOnly
                aria-label="اقفل"
                onPress={() => onOpenChange(false)}
                className="text-muted"
              >
                <CloseIcon size={22} />
              </Button>
            </Drawer.Header>
            <Drawer.Body className="flex min-h-0 flex-1 flex-col gap-4 overflow-y-auto px-5 pt-2 pb-5">
              {children}
            </Drawer.Body>
            {footer && (
              <Drawer.Footer className="flex shrink-0 flex-col gap-2.5 border-t border-line px-5 pt-3 pb-5">
                {footer}
              </Drawer.Footer>
            )}
          </Drawer.Dialog>
        </Drawer.Content>
      </Drawer.Backdrop>
    </Drawer>
  );
}
