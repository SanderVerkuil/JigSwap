"use client";

import {
  tourButtonState,
  type TourButtonState,
} from "@/components/tour/controller";
import { TOURS } from "@/components/tour/definitions";
import type { WhatsNewTourProgressView } from "@jigswap/contracts";
import { useTranslations } from "use-intl";

/**
 * The entry's tour button state and label (spec Part B §1.7): "Take the tour", "Replay the tour"
 * after completing it, or "Resume tour (step 3 of 5)" when it was paused. `shortLabel` is the same
 * without the step ("Resume"), for places that already show the step next to the button (the
 * Guides tab's chip). `resumable` means a "Start over" action makes sense next to it. `state` is
 * the underlying button state.
 */
export function useTourButton(
  tourId: string,
  progress: readonly WhatsNewTourProgressView[] | undefined,
): {
  label: string;
  shortLabel: string;
  resumable: boolean;
  state: TourButtonState;
} {
  const t = useTranslations("whatsNew.tour");
  const state = tourButtonState(
    progress?.find((p) => p.tourId === tourId),
    TOURS.get(tourId)?.steps.length ?? 0,
  );
  switch (state.kind) {
    case "resume":
      return {
        label: t("resume", { step: state.step, total: state.total }),
        shortLabel: t("resumeShort"),
        resumable: true,
        state,
      };
    case "replay": {
      const label = t("replay");
      return { label, shortLabel: label, resumable: false, state };
    }
    default: {
      const label = t("take");
      return { label, shortLabel: label, resumable: false, state };
    }
  }
}
