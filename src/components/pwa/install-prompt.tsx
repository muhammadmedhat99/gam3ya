"use client";

import { Button } from "@heroui/react";
import { useEffect, useState, type ReactNode } from "react";
import { BottomSheet } from "@/components/ui/bottom-sheet";
import { CoinsIcon, InfoIcon } from "@/components/ui/icons";
import { Notice } from "@/components/ui/notice";

/** Fired by Chromium browsers when the app is installable. */
interface BeforeInstallPromptEvent extends Event {
  prompt: () => Promise<void>;
  userChoice: Promise<{ outcome: "accepted" | "dismissed" }>;
}

type Platform = "ios" | "android" | "in-app" | "desktop";

const DISMISS_KEY = "gam3ya:install-dismissed-at";
const SNOOZE_MS = 14 * 24 * 60 * 60 * 1000;
const SHOW_DELAY_MS = 2500;
/** Dispatch this on window to open the steps manually (e.g. from the profile page). */
export const SHOW_INSTALL_EVENT = "gam3ya:show-install";

function detectPlatform(): Platform {
  const ua = navigator.userAgent;
  // Facebook / Instagram / Messenger / TikTok / Snapchat in-app browsers can't install.
  if (/FBAN|FBAV|FB_IAB|Instagram|Messenger|musical_ly|TikTok|Snapchat|Line\//i.test(ua)) return "in-app";
  const iPadOS = navigator.platform === "MacIntel" && navigator.maxTouchPoints > 1;
  if (/iPhone|iPad|iPod/i.test(ua) || iPadOS) return "ios";
  if (/Android/i.test(ua)) return "android";
  return "desktop";
}

function isInstalled(): boolean {
  return (
    window.matchMedia("(display-mode: standalone)").matches ||
    (navigator as Navigator & { standalone?: boolean }).standalone === true
  );
}

function recentlyDismissed(): boolean {
  try {
    const at = Number(localStorage.getItem(DISMISS_KEY));
    return Number.isFinite(at) && at > 0 && Date.now() - at < SNOOZE_MS;
  } catch {
    return false;
  }
}

function rememberDismissal() {
  try {
    localStorage.setItem(DISMISS_KEY, String(Date.now()));
  } catch {
    // Private mode / blocked storage: the prompt may show again, which is fine.
  }
}

// --- small inline icons matching the system UI the user will look for -------

const ShareIcon = () => (
  <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
    <path d="M12 15V3.5M8 7.5l4-4 4 4" />
    <path d="M7 10.5H5.5a1.5 1.5 0 0 0-1.5 1.5v7.5A1.5 1.5 0 0 0 5.5 21h13a1.5 1.5 0 0 0 1.5-1.5V12a1.5 1.5 0 0 0-1.5-1.5H17" />
  </svg>
);
const AddSquareIcon = () => (
  <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
    <rect x="4" y="4" width="16" height="16" rx="3.5" />
    <path d="M12 8.5v7M8.5 12h7" />
  </svg>
);
const DotsIcon = () => (
  <svg width="22" height="22" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
    <circle cx="12" cy="5.5" r="1.7" />
    <circle cx="12" cy="12" r="1.7" />
    <circle cx="12" cy="18.5" r="1.7" />
  </svg>
);

function Steps({ steps }: { steps: { icon: ReactNode; text: ReactNode }[] }) {
  return (
    <ol className="flex flex-col gap-3 rounded-[14px] bg-surface-2 p-4">
      {steps.map((step, i) => (
        <li key={i} className="flex items-center gap-3">
          <span className="flex size-7 shrink-0 items-center justify-center rounded-full bg-brand-50 text-body-sm font-bold text-brand-700">
            {i + 1}
          </span>
          <span className="flex size-10 shrink-0 items-center justify-center rounded-[12px] border border-line bg-surface text-brand-700">
            {step.icon}
          </span>
          <p className="text-body-sm text-body">{step.text}</p>
        </li>
      ))}
    </ol>
  );
}

const Label = ({ ar, en }: { ar: string; en: string }) => (
  <>
    <b className="text-ink">«{ar}»</b> <span className="text-muted">({en})</span>
  </>
);

/**
 * "ضيف جمعيتي على الشاشة الرئيسية": shown once on phones that haven't installed
 * the app, with a one-tap install where the browser supports it (Android) and
 * illustrated steps where it doesn't (iOS). Dismissing snoozes it for 14 days.
 */
export function InstallPrompt() {
  const [open, setOpen] = useState(false);
  const [platform, setPlatform] = useState<Platform>("desktop");
  const [deferred, setDeferred] = useState<BeforeInstallPromptEvent | null>(null);
  const [installing, setInstalling] = useState(false);

  useEffect(() => {
    const onBeforeInstall = (e: Event) => {
      e.preventDefault(); // keep it for our own button
      setDeferred(e as BeforeInstallPromptEvent);
    };
    const onInstalled = () => {
      rememberDismissal();
      setOpen(false);
      setDeferred(null);
    };
    const onManualOpen = () => {
      setPlatform(detectPlatform());
      setOpen(true);
    };
    window.addEventListener("beforeinstallprompt", onBeforeInstall);
    window.addEventListener("appinstalled", onInstalled);
    window.addEventListener(SHOW_INSTALL_EVENT, onManualOpen);

    const timer = window.setTimeout(() => {
      const p = detectPlatform();
      setPlatform(p);
      if (p !== "desktop" && !isInstalled() && !recentlyDismissed()) setOpen(true);
    }, SHOW_DELAY_MS);

    return () => {
      window.clearTimeout(timer);
      window.removeEventListener("beforeinstallprompt", onBeforeInstall);
      window.removeEventListener("appinstalled", onInstalled);
      window.removeEventListener(SHOW_INSTALL_EVENT, onManualOpen);
    };
  }, []);

  function close() {
    rememberDismissal();
    setOpen(false);
  }

  async function install() {
    if (!deferred) return;
    setInstalling(true);
    await deferred.prompt();
    const { outcome } = await deferred.userChoice;
    setInstalling(false);
    setDeferred(null);
    if (outcome === "accepted") close();
  }

  if (!open) return null;

  const installed = isInstalled();

  return (
    <BottomSheet
      isOpen
      onOpenChange={(o) => !o && close()}
      title="ضيف جمعيتي على الشاشة الرئيسية"
      subtitle="عشان تفتحها بلمسة واحدة زي أي تطبيق"
      footer={
        deferred && !installed ? (
          <>
            <Button size="lg" fullWidth isPending={installing} onPress={install}>
              ثبّت التطبيق
            </Button>
            <Button variant="ghost" fullWidth onPress={close}>
              بعدين
            </Button>
          </>
        ) : (
          <Button size="lg" fullWidth onPress={close}>
            تمام، فهمت
          </Button>
        )
      }
    >
      <div className="flex items-center gap-3">
        <span className="flex size-14 shrink-0 items-center justify-center rounded-[18px] bg-brand-600 text-white">
          <CoinsIcon size={30} />
        </span>
        <p className="text-body-sm text-body">
          هتظهر أيقونة «جمعيتي» على موبايلك، وتفتح على طول من غير ما تكتب اللينك.
        </p>
      </div>

      {installed ? (
        <Notice tone="accent" title="التطبيق متثبت بالفعل" icon={<InfoIcon />}>
          إنت فاتحه من الشاشة الرئيسية. مش محتاج تعمل حاجة.
        </Notice>
      ) : deferred ? (
        <p className="text-body-sm text-muted">دوس «ثبّت التطبيق» وأكّد. هياخد ثانية.</p>
      ) : platform === "ios" ? (
        <>
          <Steps
            steps={[
              { icon: <ShareIcon />, text: <>دوس على زرار <b className="text-ink">المشاركة</b> في Safari (تحت في نص الشاشة)</> },
              { icon: <AddSquareIcon />, text: <>انزل واختار <Label ar="إضافة إلى الشاشة الرئيسية" en="Add to Home Screen" /></> },
              { icon: <CoinsIcon size={22} />, text: <>دوس <Label ar="إضافة" en="Add" /> فوق على الشمال</> },
            ]}
          />
          <p className="text-caption text-muted">لو فاتح من Chrome على الآيفون: زرار المشاركة فوق جنب اللينك، وبعدها نفس الخطوات.</p>
        </>
      ) : platform === "android" ? (
        <Steps
          steps={[
            { icon: <DotsIcon />, text: <>دوس على <b className="text-ink">⋮</b> فوق في المتصفح</> },
            {
              icon: <AddSquareIcon />,
              text: (
                <>
                  اختار <Label ar="تثبيت التطبيق" en="Install app" /> أو <Label ar="إضافة إلى الشاشة الرئيسية" en="Add to Home screen" />
                </>
              ),
            },
            { icon: <CoinsIcon size={22} />, text: <>أكّد بـ <Label ar="تثبيت" en="Install" /></> },
          ]}
        />
      ) : platform === "in-app" ? (
        <Notice tone="warning" title="افتح اللينك في المتصفح الأول">
          إنت فاتح جمعيتي من جوه تطبيق تاني (زي فيسبوك أو إنستجرام)، والتثبيت مش بيشتغل من هنا. دوس على ⋮ أو ⋯ واختار
          «فتح في المتصفح» (Open in browser)، وبعدها هتظهرلك الخطوات.
        </Notice>
      ) : (
        <p className="text-body-sm text-muted">
          افتح جمعيتي من موبايلك عشان تضيفها على الشاشة الرئيسية. على الكمبيوتر تقدر تثبّتها من أيقونة التثبيت في شريط
          العنوان.
        </p>
      )}
    </BottomSheet>
  );
}
