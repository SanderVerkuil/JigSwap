"use client";

import type { TourButtonState } from "@/components/tour/controller";
import { Button } from "@/components/ui/button";
import { Compass } from "lucide-react";
import { useTranslations } from "use-intl";

/**
 * The done panel's "Show me around" (spec §2.8): starts the standalone `getting-started` tour.
 * While that tour is paused it reads as a resume, with the What's new resume label.
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
