"use client";

import { usePathname } from "@/compat/navigation";
import { isTextEntry } from "@/components/quick-start/logic";
import { Button } from "@/components/ui/button";
import {
  isAnyDialogOpen,
  isSurfaceBusy,
} from "@/components/whats-new/surface-busy";
import { useIsMobile } from "@/hooks/use-mobile";
import { safeStorage } from "@/lib/safe-storage";
import {
  Bell,
  Download,
  EllipsisVertical,
  Share,
  SquarePlus,
  X,
} from "lucide-react";
import { useEffect, useId, useState, type ReactNode } from "react";
import { useTranslations } from "use-intl";
import {
  neverShow,
  recordVisit,
  shouldAutoShow,
  snooze,
  type InstallMethod,
} from "./logic";
import {
  clearInstallTipRequest,
  readTipState,
  runInstallPrompt,
  trackInstall,
  useInstallMethod,
  useInstallTipRequested,
  writeTipState,
} from "./use-install-app";

// Session keys: the visit is counted once per browser session, and the tip shows itself at most
// once per session (it stays up across in-shell navigation until dismissed).
const COUNTED_KEY = "jigswap.installTip.counted";
const SHOWN_KEY = "jigswap.installTip.shown";

// Lets the route settle, page-load focus land and any higher-priority prompt claim the screen
// first (the What's new highlight waits 600ms).
const SHOW_DELAY_MS = 2500;

/** True while a text field has focus, i.e. the on-screen keyboard is (about to be) up. */
function useTextEntryFocused(): boolean {
  const [focused, setFocused] = useState(false);
  useEffect(() => {
    const update = () => {
      const el = document.activeElement;
      setFocused(
        el instanceof HTMLElement && isTextEntry(el as HTMLInputElement),
      );
    };
    document.addEventListener("focusin", update);
    document.addEventListener("focusout", update);
    return () => {
      document.removeEventListener("focusin", update);
      document.removeEventListener("focusout", update);
    };
  }, []);
  return focused;
}

// The mobile "Add JigSwap to your home screen" tip: a non-modal card stuck just above the tab bar.
// It shows itself from the second session on this device, never when installed / unsupported /
// on desktop, and only when no tour, dialog or prompt is on screen; the quick sheet's "Install
// app" row can also open it on iOS, or on Android Chrome when no install prompt was captured. Mounted in the dashboard shell only, so public and auth pages
// never see it.
export function InstallAppTip() {
  const pathname = usePathname();
  const mobile = useIsMobile();
  const method = useInstallMethod();
  const requested = useInstallTipRequested();
  const textFocused = useTextEntryFocused();
  const [autoShown, setAutoShown] = useState(false);

  // Count this session once (the first visit is never shown the tip).
  useEffect(() => {
    if (safeStorage.getItem("session", COUNTED_KEY) === "1") return;
    safeStorage.setItem("session", COUNTED_KEY, "1");
    writeTipState(recordVisit(readTipState()));
  }, []);

  useEffect(() => {
    if (autoShown || !method || !mobile) return;
    if (safeStorage.getItem("session", SHOWN_KEY) === "1") return;
    const timer = window.setTimeout(() => {
      const show = shouldAutoShow({
        method,
        standalone: false,
        mobile,
        state: readTipState(),
        now: Date.now(),
        busy:
          isSurfaceBusy() ||
          isAnyDialogOpen() ||
          (document.activeElement instanceof HTMLElement &&
            isTextEntry(document.activeElement as HTMLInputElement)),
      });
      if (!show) return;
      safeStorage.setItem("session", SHOWN_KEY, "1");
      setAutoShown(true);
      trackInstall("install_tip_shown", { method, trigger: "auto" });
    }, SHOW_DELAY_MS);
    return () => window.clearTimeout(timer);
  }, [pathname, method, mobile, autoShown]);

  useEffect(() => {
    if (requested && method) {
      trackInstall("install_tip_shown", { method, trigger: "menu" });
    }
  }, [requested, method]);

  const open = (autoShown || requested) && method !== null && mobile;
  if (!open || textFocused) return null;

  const close = (action: "snooze" | "never" | "installed") => {
    // Focus first: the control that has it is about to unmount.
    const card = document.getElementById(TIP_ID);
    if (card?.contains(document.activeElement)) {
      const main = document.querySelector<HTMLElement>("main");
      main?.setAttribute("tabindex", "-1");
      main?.focus({ preventScroll: true });
    }
    setAutoShown(false);
    clearInstallTipRequest();
    if (action === "installed") return;
    const state = readTipState();
    writeTipState(
      action === "never" ? neverShow(state) : snooze(state, Date.now()),
    );
    trackInstall("install_tip_dismissed", { method, action });
  };

  return (
    <InstallAppTipView
      method={method}
      onInstall={() => {
        void runInstallPrompt("tip").then((accepted) => {
          if (accepted) close("installed");
        });
      }}
      onSnooze={() => close("snooze")}
      onNever={() => close("never")}
    />
  );
}

const TIP_ID = "install-app-tip";

export function InstallAppTipView({
  method,
  onInstall,
  onSnooze,
  onNever,
}: {
  method: InstallMethod;
  onInstall: () => void;
  onSnooze: () => void;
  onNever: () => void;
}) {
  const t = useTranslations("installApp");
  const headingId = useId();

  return (
    // Sticky just above the tab bar (57px = its 56px row + 1px border; keep in sync with
    // MobileTabBar). The bottom padding clears the raised "+" (22px overhang + 4px ring) with an
    // 8px gap and, in normal flow, reserves room so the last content row never hides under it.
    <div className="pointer-events-none sticky bottom-[57px] z-20 shrink-0 px-3 pb-[34px] md:hidden">
      <section
        id={TIP_ID}
        aria-labelledby={headingId}
        className="bg-card text-card-foreground border-jigsaw-primary/20 animate-in fade-in slide-in-from-bottom-3 pointer-events-auto rounded-2xl border p-4 shadow-[0_12px_32px_-12px_rgb(0_0_0/0.28)] duration-300 ease-out motion-reduce:animate-none dark:shadow-[0_12px_32px_-8px_rgb(0_0_0/0.6)]"
      >
        <div className="flex items-start gap-3">
          <img
            src="/icon-192.png"
            alt=""
            width={42}
            height={42}
            className="ring-border size-[42px] shrink-0 rounded-[10px] bg-white p-1 ring-1"
          />
          <div className="min-w-0 flex-1">
            <h2 id={headingId} className="text-sm font-semibold">
              {t("title")}
            </h2>
            {method === "prompt" && (
              <p className="text-muted-foreground mt-0.5 text-sm">
                {t("promptBody")}
              </p>
            )}
          </div>
          <Button
            variant="ghost"
            size="icon"
            className="-mt-2 -mr-2 size-11"
            aria-label={t("dontShowAgain")}
            title={t("dontShowAgain")}
            onClick={onNever}
          >
            <X aria-hidden />
          </Button>
        </div>

        {method === "ios" && (
          <>
            <ol className="mt-3 space-y-2 text-sm">
              <Step number={1}>
                {t.rich("iosStepShare", {
                  icon: () => <Glyph icon={<Share className="size-4" />} />,
                  b: (chunks) => (
                    <strong className="font-semibold">{chunks}</strong>
                  ),
                })}
              </Step>
              <Step number={2}>
                {t.rich("iosStepAdd", {
                  icon: () => (
                    <Glyph icon={<SquarePlus className="size-4" />} />
                  ),
                  b: (chunks) => (
                    <strong className="font-semibold">{chunks}</strong>
                  ),
                })}
              </Step>
            </ol>
            <p className="text-muted-foreground mt-3 flex items-start gap-1.5 text-xs">
              <Bell aria-hidden className="mt-px size-3.5 shrink-0" />
              {t("iosPush")}
            </p>
          </>
        )}

        {method === "android-menu" && (
          <ol className="mt-3 space-y-2 text-sm">
            <Step number={1}>
              {t.rich("androidStepMenu", {
                icon: () => (
                  <Glyph icon={<EllipsisVertical className="size-4" />} />
                ),
                b: (chunks) => (
                  <strong className="font-semibold">{chunks}</strong>
                ),
              })}
            </Step>
            <Step number={2}>
              {t.rich("androidStepInstall", {
                icon: () => <Glyph icon={<Download className="size-4" />} />,
                b: (chunks) => (
                  <strong className="font-semibold">{chunks}</strong>
                ),
              })}
            </Step>
          </ol>
        )}

        <div className="mt-3 flex justify-end gap-2">
          {method === "prompt" && (
            <Button
              className="bg-jigsaw-primary hover:bg-jigsaw-primary/90 h-11 flex-1 text-white"
              onClick={onInstall}
            >
              <Download aria-hidden />
              {t("install")}
            </Button>
          )}
          <Button variant="ghost" className="h-11" onClick={onSnooze}>
            {t("notNow")}
          </Button>
        </div>
      </section>
    </div>
  );
}

function Step({ number, children }: { number: number; children: ReactNode }) {
  return (
    <li className="flex items-center gap-2">
      <span className="text-muted-foreground w-4 shrink-0 tabular-nums">
        {number}.
      </span>
      <span className="min-w-0">{children}</span>
    </li>
  );
}

function Glyph({ icon }: { icon: ReactNode }) {
  return (
    <span
      aria-hidden
      className="bg-muted mx-0.5 inline-flex size-7 items-center justify-center rounded-md border align-middle"
    >
      {icon}
    </span>
  );
}
