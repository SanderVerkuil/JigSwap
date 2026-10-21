"use client";

import { Button } from "@/components/ui/button";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import type { TourLauncher } from "@/components/whats-new/tour-launcher";
import { useLocation } from "@tanstack/react-router";
import { CircleHelp } from "lucide-react";
import { useTranslations } from "use-intl";

/**
 * The "?" in a page header: starts the page's guide at its first step on this page, even when the
 * guide was paused elsewhere (earlier steps, on other pages, stay reachable with Back).
 *
 * Header actions render in the shell's page head, outside TourProvider, so the page passes in its
 * `startTour` (from useTourLauncher) instead of this button reading the context there.
 */
export function GuideHelpButton({
  tourId,
  startTour,
}: {
  tourId: string;
  startTour: TourLauncher["startTour"];
}) {
  const t = useTranslations("tour");
  const pathname = useLocation({ select: (location) => location.pathname });
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <Button
          variant="ghost"
          size="icon"
          className="text-muted-foreground size-8"
          aria-label={t("help")}
          onClick={(event) =>
            startTour(tourId, {
              returnFocus: event.currentTarget,
              fromRoute: pathname,
            })
          }
        >
          <CircleHelp aria-hidden />
        </Button>
      </TooltipTrigger>
      <TooltipContent>{t("help")}</TooltipContent>
    </Tooltip>
  );
}
