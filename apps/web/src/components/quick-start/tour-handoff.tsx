"use client";

import {
  tourButtonState,
  type TourButtonState,
} from "@/components/tour/controller";
import { TOURS } from "@/components/tour/definitions";
import { Button } from "@/components/ui/button";
import { useTourLauncher } from "@/components/whats-new/tour-launcher";
import { useWhatsNewState } from "@/components/whats-new/use-whats-new-state";
import { Compass } from "lucide-react";
import { useTranslations } from "use-intl";

const HANDOFF_TOUR = "getting-started";

/**
 * "Show me around" (spec §2.8) on the /welcome done panel and the dashboard's Quick setup card:
 * the standalone `getting-started` tour through the shared runner, resuming at the saved step
 * when it was paused. Needs the _dashboard layout's TourProvider above it.
 */
export function GettingStartedTourButton() {
  const { startTour } = useTourLauncher();
  const { tours } = useWhatsNewState();
  const state = tourButtonState(
    tours?.find((p) => p.tourId === HANDOFF_TOUR),
    TOURS.get(HANDOFF_TOUR)?.steps.length ?? 0,
  );
  return (
    <TourHandoffButton
      state={state}
      onStart={(returnFocus) => startTour(HANDOFF_TOUR, { returnFocus })}
    />
  );
}

/**
 * The "Show me around" button itself: starts the standalone `getting-started` tour. While that
 * tour is paused it reads as a resume, with the What's new resume label.
 */
export function TourHandoffButton({
  state,
  onStart,
}: {
  state: TourButtonState;
  onStart: (returnFocus: HTMLElement) => void;
}) {
  const t = useTranslations();
  return (
    <Button
      type="button"
      variant="outline"
      className="pointer-coarse:min-h-11"
      onClick={(event) => onStart(event.currentTarget)}
    >
      <Compass aria-hidden="true" />
      {state.kind === "resume"
        ? t("whatsNew.tour.resume", { step: state.step, total: state.total })
        : t("quickStart.done.tour")}
    </Button>
  );
}
