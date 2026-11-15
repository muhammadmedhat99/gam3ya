"use client";

import { Button, Drawer } from "@heroui/react";
import { CloseIcon } from "@/components/ui/icons";

const STEPS = [
  "كلّم صاحب التطبيق وقوله رقم موبايلك",
  "هيعملك كلمة سر مؤقتة ويبعتهالك",
  "ادخل بيها، وهنطلب منك تختار واحدة جديدة على طول",
];

/** Design "1 · نسيت كلمة السر (شيت)": no self-service reset (AGENTS.md §4). */
export function ForgotPasswordSheet() {
  return (
    <Drawer>
      <Button variant="ghost" className="-mt-2 self-start px-1">
        انسى كلمة السر؟
      </Button>
      <Drawer.Backdrop>
        <Drawer.Content placement="bottom">
          <Drawer.Dialog aria-label="نسيت كلمة السر؟" className="flex flex-col">
            {({ close }) => (
              <>
                <Drawer.Handle />
                <Drawer.Header className="flex items-center gap-2 ps-5 pe-2 pt-2 pb-1">
                  <Drawer.Heading className="flex-1 text-title-2 text-ink">نسيت كلمة السر؟</Drawer.Heading>
                  <Button variant="ghost" isIconOnly aria-label="اقفل" onPress={close} className="text-muted">
                    <CloseIcon size={22} />
                  </Button>
                </Drawer.Header>
                <Drawer.Body className="flex flex-col gap-4 px-5 pt-2 pb-5">
                  <p className="text-body text-body">
                    عشان نحافظ على حسابك ومحدش ياخده، مفيش استرجاع تلقائي لكلمة السر في جمعيتي.
                  </p>
                  <ol className="flex flex-col gap-3 rounded-[14px] bg-surface-2 p-4">
                    {STEPS.map((step, i) => (
                      <li key={step} className="flex items-start gap-3">
                        <span className="flex size-7 shrink-0 items-center justify-center rounded-full bg-brand-50 text-body-sm font-bold text-brand-700">
                          {i + 1}
                        </span>
                        <p className="text-body-sm text-body">{step}</p>
                      </li>
                    ))}
                  </ol>
                </Drawer.Body>
                <Drawer.Footer className="border-t border-line px-5 pt-3 pb-5">
                  <Button size="lg" fullWidth onPress={close}>
                    تمام، فهمت
                  </Button>
                </Drawer.Footer>
              </>
            )}
          </Drawer.Dialog>
        </Drawer.Content>
      </Drawer.Backdrop>
    </Drawer>
  );
}
