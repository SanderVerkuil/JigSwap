"use client";

import { useReportSurfaceBusy } from "@/components/whats-new/surface-busy";
import {
  TourLauncherContext,
  type TourLauncher,
} from "@/components/whats-new/tour-launcher";
import { useWhatsNewState } from "@/components/whats-new/use-whats-new-state";
import { gateway } from "@/gateway";
import { useConvexMutation } from "@convex-dev/react-query";
import { useNavigate, useRouter } from "@tanstack/react-router";
import {
  useEffect,
  useMemo,
  useRef,
  useState,
  useSyncExternalStore,
  type ReactNode,
} from "react";
import { toast } from "sonner";
import { useTranslations } from "use-intl";
import { resolveStartIndex, TourController } from "./controller";
import { isStandaloneTour, TOURS } from "./definitions";
import { TourLayer } from "./tour-layer";

/** The first rendered (non-zero box) element with `data-tour="<anchor>"`: responsive layouts mount
 * some anchors twice (sidebar and mobile top bar), and only one of them is visible. */
export function findVisibleAnchor(anchor: string): HTMLElement | null {
  for (const el of document.querySelectorAll<HTMLElement>(
    `[data-tour="${anchor}"]`,
  )) {
    const rect = el.getBoundingClientRect();
    if (rect.width > 0 || rect.height > 0) return el;
  }
  return null;
}

/** Back to the element that started the tour when it is still mounted, else the page's main. */
function restoreFocus(element: HTMLElement | null) {
  if (element?.isConnected) {
    element.focus();
    return;
  }
  const main = document.querySelector("main");
  if (!main) return;
  if (!main.hasAttribute("tabindex")) main.setAttribute("tabindex", "-1");
  main.focus();
}

// The real TourLauncher (W2's seam): runs a tour from TOURS over the dashboard, persists progress
// with recordTourProgress, and reports itself busy so the highlight modal never opens on top.
// Mounted in the dashboard layout so a tour survives its own cross-page navigation.
export function TourProvider({ children }: { children: ReactNode }) {
  const t = useTranslations("tour");
  const router = useRouter();
  const navigate = useNavigate();
  const record = useConvexMutation(gateway.whatsNew.recordTourProgress);
  const { tours: progress } = useWhatsNewState();
  const returnFocusRef = useRef<HTMLElement | null>(null);

  const [controller] = useState(
    () =>
      new TourController<HTMLElement>({
        tours: TOURS,
        // The resolved location, so an anchor the old page also has (the account menu lives in
        // the shell) is not taken before the new page has loaded.
        currentPath: () =>
          (router.state.resolvedLocation ?? router.state.location).pathname,
        navigate: (route) => {
          void navigate({ to: route });
        },
        findTarget: findVisibleAnchor,
      }),
  );

  // What the controller calls back into changes across renders (the mutation, translations), so
  // it is connected after mount and reconnected on change.
  useEffect(
    () =>
      controller.connect({
        record: (write) => {
          record(write).catch((error: unknown) =>
            console.error("Failed to save tour progress:", error),
          );
        },
        onEnd: ({ tourId, index, reason }) => {
          // After the card unmounts, so Radix's focus scope does not take focus back.
          const returnFocus = returnFocusRef.current;
          requestAnimationFrame(() => restoreFocus(returnFocus));
          if (reason === "completed") {
            toast.success(t("completedTitle"), {
              description: t("completed"),
            });
          } else {
            // A standalone tour has no What's new entry to resume it from.
            toast(t(isStandaloneTour(tourId) ? "pausedStandalone" : "paused"), {
              action: {
                label: t("resumeAction"),
                onClick: () => controller.start(tourId, index),
              },
            });
          }
        },
      }),
    [controller, record, t],
  );

  const snapshot = useSyncExternalStore(
    controller.subscribe,
    controller.getSnapshot,
    controller.getSnapshot,
  );
  useReportSurfaceBusy("tour", snapshot.status === "running");

  const launcher = useMemo<TourLauncher>(
    () => ({
      startTour: (tourId, options) => {
        const tour = TOURS.get(tourId);
        if (!tour) return;
        returnFocusRef.current = options?.returnFocus ?? null;
        const saved = progress?.find((p) => p.tourId === tourId);
        controller.start(
          tourId,
          options?.restart ? 0 : resolveStartIndex(saved, tour.steps.length),
        );
      },
    }),
    [controller, progress],
  );

  const actions = useMemo(
    () => ({
      onNext: () => controller.next(),
      onBack: () => controller.back(),
      onPause: () => controller.pause(),
      onKey: (key: string) => controller.handleKey(key),
    }),
    [controller],
  );

  return (
    <TourLauncherContext.Provider value={launcher}>
      {children}
      {snapshot.status === "running" && (
        <TourLayer snapshot={snapshot} actions={actions} />
      )}
    </TourLauncherContext.Provider>
  );
}
