"use client";

import { usePathname } from "@/compat/navigation";
import { isImmersiveMobileRoute } from "@/components/dashboard-layout/route-meta";
import { isTextEntry } from "@/components/quick-start/logic";
import { Button } from "@/components/ui/button";
import {
  isAnyDialogOpen,
  isSurfaceBusy,
  useSurfaceBusy,
} from "@/components/whats-new/surface-busy";
import { useIsMobile } from "@/hooks/use-mobile";
import { safeStorage } from "@/lib/safe-storage";
import { cn } from "@/lib/utils";
import {
  Bell,
  ChevronDown,
  Download,
  EllipsisVertical,
  Share,
  SquarePlus,
  X,
} from "lucide-react";
import { useEffect, useId, useState, type ReactNode } from "react";
import { useTranslations } from "use-intl";
import {
  installTipBlockedOn,
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

// The mobile "Add JigSwap to your home screen" tip: a non-modal row stuck just above the tab bar
// that expands into the install steps. It shows itself from the second session on this device,
// never when installed / unsupported / on desktop, never on the pages installTipBlockedOn lists
// (an open thread, the quick start, forms) or while a surface reports busy, and only when no tour,
// dialog or prompt is on screen;
// the quick sheet's "Install app" row can also open it (expanded) on iOS, on Android Chrome when
// no install prompt was captured, and on Firefox (Android and iOS), which never fires one.
// Mounted in the dashboard shell only, so public and auth pages never see it.
export function InstallAppTip() {
  const pathname = usePathname();
  const mobile = useIsMobile();
  const method = useInstallMethod();
  const requested = useInstallTipRequested();
  const textFocused = useTextEntryFocused();
  const [autoShown, setAutoShown] = useState(false);
  const blocked = installTipBlockedOn(pathname);
  const surfaceBusy = useSurfaceBusy();

  // Count this session once (the first visit is never shown the tip).
  useEffect(() => {
    if (safeStorage.getItem("session", COUNTED_KEY) === "1") return;
    safeStorage.setItem("session", COUNTED_KEY, "1");
    writeTipState(recordVisit(readTipState()));
  }, []);

  // Re-armed on every navigation, so a blocked page only postpones the tip to the next one.
  useEffect(() => {
    if (autoShown || !method || !mobile || blocked) return;
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
  }, [pathname, method, mobile, autoShown, blocked]);

  useEffect(() => {
    if (requested && method) {
      trackInstall("install_tip_shown", { method, trigger: "menu" });
    }
  }, [requested, method]);

  const open = (autoShown || requested) && method !== null && mobile;
  // A tip that is up steps aside on blocked pages and while a surface owns the bottom of the screen
  // (My Puzzles' selection bar sits exactly where the tip docks, and would be untappable under it),
  // and is back afterwards: nothing is dismissed. One the member asked for still shows there, except
  // on an open thread, whose composer owns the bottom of the screen.
  const hidden = requested
    ? isImmersiveMobileRoute(pathname)
    : blocked || surfaceBusy;
  if (!open || textFocused || hidden) return null;

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
      // Asked for from the quick sheet: open on the steps (remounting a collapsed auto tip).
      key={requested ? "requested" : "auto"}
      method={method}
      defaultExpanded={requested}
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
  defaultExpanded = false,
  onInstall,
  onSnooze,
  onNever,
}: {
  method: InstallMethod;
  /** Open on the steps (the member asked for them) instead of the one-row summary. */
  defaultExpanded?: boolean;
  onInstall: () => void;
  onSnooze: () => void;
  onNever: () => void;
}) {
  const t = useTranslations("installApp");
  const headingId = useId();
  const bodyId = useId();
  const [expanded, setExpanded] = useState(defaultExpanded);

  return (
    // Sticky just above the tab bar, at the height it publishes (it grows in the installed app;
    // 57px = its 56px row + 1px border until it has measured). The bottom padding clears the
    // raised "+" (12px, see MOBILE_TAB_BAR_RAISE) with an 8px gap and, in normal flow, reserves
    // room so the last content row never hides under the tip.
    <div className="pointer-events-none sticky bottom-[var(--mobile-tab-bar-height,57px)] z-20 shrink-0 px-3 pb-5 md:hidden">
      <section
        id={TIP_ID}
        aria-labelledby={headingId}
        className="bg-card text-card-foreground border-jigsaw-primary/20 animate-in fade-in slide-in-from-bottom-3 pointer-events-auto rounded-2xl border p-1.5 pl-3 shadow-[0_12px_32px_-12px_rgb(0_0_0/0.28)] duration-300 ease-out motion-reduce:animate-none dark:shadow-[0_12px_32px_-8px_rgb(0_0_0/0.6)]"
      >
        {/* One row: the app icon, what this is, How? to expand, and ✕ for "not now". */}
        <div className="flex items-center gap-2">
          <img
            src="/icon-192.png"
            alt=""
            width={32}
            height={32}
            className="ring-border size-8 shrink-0 rounded-lg bg-white p-0.5 ring-1"
          />
          {/* Wraps rather than truncates on narrow phones; two lines still fit the 44px row. */}
          <h2
            id={headingId}
            className="line-clamp-2 min-w-0 flex-1 text-sm leading-tight font-semibold"
          >
            {t("collapsedTitle")}
          </h2>
          <Button
            variant="ghost"
            className="h-11 shrink-0 gap-1"
            aria-expanded={expanded}
            aria-controls={bodyId}
            onClick={() => setExpanded((value) => !value)}
          >
            {t("how")}
            <ChevronDown
              aria-hidden
              className={cn(
                "transition-transform motion-reduce:transition-none",
                expanded && "rotate-180",
              )}
            />
          </Button>
          <Button
            variant="ghost"
            size="icon"
            className="size-11 shrink-0"
            aria-label={t("notNow")}
            title={t("notNow")}
            onClick={onSnooze}
          >
            <X aria-hidden />
          </Button>
        </div>

        <div id={bodyId} hidden={!expanded} className="pr-1.5 pb-1.5">
          {method === "prompt" && (
            <p className="text-muted-foreground mt-1 text-sm">
              {t("promptBody")}
            </p>
          )}

          {(method === "ios" || method === "ios-firefox") && (
            <>
              <ol className="mt-2 space-y-2 text-sm">
                <Step number={1}>
                  {t.rich(
                    method === "ios" ? "iosStepShare" : "firefoxIosStepShare",
                    {
                      icon: () => <Glyph icon={<Share className="size-4" />} />,
                      b: (chunks) => (
                        <strong className="font-semibold">{chunks}</strong>
                      ),
                    },
                  )}
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

          {(method === "android-menu" || method === "firefox-menu") && (
            <ol className="mt-2 space-y-2 text-sm">
              <Step number={1}>
                {t.rich(
                  method === "android-menu"
                    ? "androidStepMenu"
                    : "firefoxStepMenu",
                  {
                    icon: () => (
                      <Glyph icon={<EllipsisVertical className="size-4" />} />
                    ),
                    b: (chunks) => (
                      <strong className="font-semibold">{chunks}</strong>
                    ),
                  },
                )}
              </Step>
              <Step number={2}>
                {t.rich(
                  method === "android-menu"
                    ? "androidStepInstall"
                    : "firefoxStepAdd",
                  {
                    icon: () => (
                      <Glyph icon={<Download className="size-4" />} />
                    ),
                    b: (chunks) => (
                      <strong className="font-semibold">{chunks}</strong>
                    ),
                  },
                )}
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
            {/* ✕ only snoozes; turning the tip off for good is this explicit choice. */}
            <Button variant="ghost" className="h-11" onClick={onNever}>
              {t("dontShowAgain")}
            </Button>
          </div>
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
