"use client";

import {
  GUIDE_AREAS,
  guideMessageKeys,
  TOURS,
  type TourDefinition,
} from "@/components/tour/definitions";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { cn } from "@/lib/utils";
import type { WhatsNewEntry } from "@/whats-new/types";
import type { WhatsNewTourProgressView } from "@jigswap/contracts";
import { Link } from "@tanstack/react-router";
import { ArrowRight, Check, Compass } from "lucide-react";
import { useFormatter, useTranslations } from "use-intl";
import { CATEGORY_META } from "./category-chip";
import { useTourButton } from "./tour-button";
import { useTourLauncher } from "./tour-launcher";

// The /whats-new Guides tab: every tour in TOURS as a compact card, grouped by area, with the
// member's progress. `entries` link a guide back to the update that introduced it; `tours` is the
// saved tour progress (undefined while it loads: every guide then shows as not started).
export function GuidesList({
  entries,
  tours,
}: {
  entries: readonly WhatsNewEntry[];
  tours: readonly WhatsNewTourProgressView[] | undefined;
}) {
  const t = useTranslations("whatsNew.guides");
  const all = [...TOURS.values()];
  if (all.length === 0) return <EmptyState />;

  const done = all.filter((tour) =>
    tours?.some((p) => p.tourId === tour.id && p.status === "completed"),
  ).length;

  return (
    <div className="mx-auto flex w-full max-w-3xl flex-col gap-8">
      <p className="text-muted-foreground text-sm">
        {t("progress", { done, total: all.length })}
      </p>
      {GUIDE_AREAS.map((area) => {
        const inArea = all.filter((tour) => tour.guide.area === area);
        if (inArea.length === 0) return null;
        const headingId = `guides-${area}`;
        return (
          <section key={area} aria-labelledby={headingId}>
            <h2
              id={headingId}
              className="text-muted-foreground mb-4 flex items-center gap-3 font-mono text-[11px] font-medium tracking-[0.09em] uppercase"
            >
              {t(`areas.${area}`)}
              <span aria-hidden className="bg-border h-px flex-1" />
            </h2>
            <ul className="flex flex-col gap-3">
              {inArea.map((tour) => (
                <li key={tour.id}>
                  <GuideCard
                    tour={tour}
                    entry={entries.find((entry) => entry.tour === tour.id)}
                    tours={tours}
                  />
                </li>
              ))}
            </ul>
          </section>
        );
      })}
    </div>
  );
}

function GuideCard({
  tour,
  entry,
  tours,
}: {
  tour: TourDefinition;
  entry: WhatsNewEntry | undefined;
  tours: readonly WhatsNewTourProgressView[] | undefined;
}) {
  const t = useTranslations();
  const format = useFormatter();
  const { startTour } = useTourLauncher();
  const { label, resumable, state } = useTourButton(tour.id, tours);
  const keys = guideMessageKeys(tour.id);
  const titleId = `guide-${tour.id}-title`;
  const Icon = tour.guide.icon;

  return (
    <article
      id={`guide-${tour.id}`}
      aria-labelledby={titleId}
      className="scroll-mt-28"
    >
      <Card className="flex-col gap-4 p-4 sm:flex-row sm:items-center sm:p-5">
        <div className="flex min-w-0 flex-1 items-start gap-4">
          <div
            aria-hidden
            className="bg-jigsaw-primary/10 text-jigsaw-primary dark:bg-jigsaw-primary/20 flex size-10 shrink-0 items-center justify-center rounded-lg dark:text-violet-300 [&>svg]:size-5"
          >
            <Icon />
          </div>
          <div className="flex min-w-0 flex-1 flex-col gap-1">
            <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
              {/* tabIndex -1: a #guide-{id} deep link moves focus here (see the route). */}
              <h3
                id={titleId}
                tabIndex={-1}
                className="font-heading text-card-foreground leading-tight font-semibold focus-visible:outline-none"
              >
                {t(keys.title)}
              </h3>
              {state.kind === "resume" && (
                <span className="bg-muted text-muted-foreground rounded-full px-2.5 py-0.5 text-xs font-semibold">
                  {t("tour.stepOf", { step: state.step, total: state.total })}
                </span>
              )}
              {state.kind === "replay" && (
                <span
                  className={cn(
                    "inline-flex items-center gap-1 rounded-full px-2.5 py-0.5 text-xs font-semibold [&>svg]:size-3",
                    CATEGORY_META.improvement.className,
                  )}
                >
                  {t("whatsNew.guides.done")}
                  <Check aria-hidden />
                </span>
              )}
            </div>
            <p className="text-muted-foreground text-sm">
              {t(keys.description)}
            </p>
            <p className="text-muted-foreground flex flex-wrap gap-x-3 text-xs">
              <span>
                {t("whatsNew.guides.steps", { count: tour.steps.length })}
              </span>
              {entry && (
                <Link
                  to="/whats-new"
                  search={{}}
                  hash={`entry-${entry.id}`}
                  className="hover:text-foreground inline-flex items-center gap-1 underline-offset-2 hover:underline"
                >
                  {t("whatsNew.guides.introduced", {
                    month: format.dateTime(new Date(entry.publishedAt), {
                      month: "long",
                      year: "numeric",
                      timeZone: "UTC",
                    }),
                  })}
                  <ArrowRight aria-hidden className="size-3" />
                </Link>
              )}
            </p>
          </div>
        </div>
        <div className="flex flex-col gap-2 sm:shrink-0 sm:flex-row sm:items-center">
          {resumable && (
            <Button
              variant="ghost"
              size="sm"
              className="order-last w-full sm:order-first sm:w-auto"
              onClick={(event) =>
                startTour(tour.id, {
                  returnFocus: event.currentTarget,
                  restart: true,
                })
              }
            >
              {t("whatsNew.tour.restart")}
            </Button>
          )}
          <Button
            variant={state.kind === "replay" ? "outline" : "default"}
            className={cn(
              "w-full sm:w-auto",
              state.kind !== "replay" &&
                "bg-jigsaw-primary hover:bg-jigsaw-primary/90 text-white",
            )}
            onClick={(event) =>
              startTour(tour.id, { returnFocus: event.currentTarget })
            }
          >
            <Compass aria-hidden />
            {label}
          </Button>
        </div>
      </Card>
    </article>
  );
}

function EmptyState() {
  const t = useTranslations("whatsNew.guides.empty");
  return (
    <div className="mx-auto w-full max-w-3xl">
      <Card>
        <CardContent className="p-12 text-center">
          <div className="bg-muted mx-auto mb-4 flex size-16 items-center justify-center rounded-full">
            <Compass aria-hidden className="text-muted-foreground size-8" />
          </div>
          <h2 className="mb-2 text-lg font-medium">{t("title")}</h2>
          <p className="text-muted-foreground text-sm">{t("body")}</p>
        </CardContent>
      </Card>
    </div>
  );
}
