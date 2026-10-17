"use client";

import { tourButtonState } from "@/components/tour/controller";
import { TOURS } from "@/components/tour/definitions";
import type { WhatsNewTourProgressView } from "@jigswap/contracts";
import { useTranslations } from "use-intl";

/**
 * The entry's tour button state and label (spec Part B §1.7): "Take the tour", "Replay the tour"
 * after completing it, or "Resume tour (step 3 of 5)" when it was paused. `resumable` means a
 * "Start over" action makes sense next to it.
 */
export function useTourButton(
  tourId: string,
  progress: readonly WhatsNewTourProgressView[] | undefined,
): { label: string; resumable: boolean } {
  const t = useTranslations("whatsNew.tour");
  const state = tourButtonState(
    progress?.find((p) => p.tourId === tourId),
    TOURS.get(tourId)?.steps.length ?? 0,
  );
  switch (state.kind) {
    case "resume":
      return {
        label: t("resume", { step: state.step, total: state.total }),
        resumable: true,
      };
    case "replay":
      return { label: t("replay"), resumable: false };
    default:
      return { label: t("take"), resumable: false };
  }
}
