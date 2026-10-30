"use client";

import { Link } from "@/compat/link";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { cn } from "@/lib/utils";
import type { WhatsNewEntry } from "@/whats-new/types";
import type { WhatsNewTourProgressView } from "@jigswap/contracts";
import { ArrowRight, ChevronDown, Compass, Sparkles } from "lucide-react";
import { useState } from "react";
import { flushSync } from "react-dom";
import { useFormatter, useLocale, useTranslations } from "use-intl";
import {
  CATEGORY_META,
  CategoryChip,
  COUNT_PILL_COLORS,
} from "./category-chip";
import {
  categoriesIn,
  contentFor,
  groupByMonth,
  isoDateUtc,
  visibleEntries,
  type WhatsNewCategoryFilter,
} from "./logic";
import { WHATS_NEW_PROSE } from "./prose";
import { useTourButton } from "./tour-button";
import { useTourLauncher } from "./tour-launcher";

// Touch-sized controls: 44px tall on a coarse pointer, the desktop size otherwise.
const TOUCH_TARGET = "pointer-coarse:min-h-11";

// The /whats-new reading column (spec Part B §1): one section per UTC month, newest first, each an
// ordered list of entry cards. `unreadIds` is the snapshot taken when the page mounted, or
// undefined while the read state loads: the cards render without pills until then (entries are
// bundled, so there is no skeleton). `tours` is the member's saved tour progress (resume labels).
// `deepLinkId` is the entry a #entry-{id} link points at.
//
// Readable on a phone (UX-90): only the newest page renders, plus every unread entry and the
// deep-linked one (visibleEntries), with "Show N older updates" for the rest; a category filter
// narrows the list; each card shows its summary and keeps the image and body behind "Read more",
// open for unread and deep-linked entries.
export function WhatsNewList({
  entries,
  unreadIds,
  tours,
  deepLinkId,
}: {
  entries: readonly WhatsNewEntry[];
  unreadIds: readonly string[] | undefined;
  tours?: readonly WhatsNewTourProgressView[];
  deepLinkId?: string;
}) {
  const t = useTranslations("whatsNew");
  const format = useFormatter();
  const [category, setCategory] = useState<WhatsNewCategoryFilter>("all");
  const [showOlder, setShowOlder] = useState(false);

  if (entries.length === 0) return <EmptyState />;

  const { visible, olderCount } = visibleEntries({
    entries,
    category,
    showOlder,
    unreadIds,
    deepLinkId,
  });
  const categories = categoriesIn(entries);
  const unread = new Set(unreadIds);

  // The button disappears once pressed, so focus moves to the first entry it revealed.
  const revealOlder = () => {
    const shown = new Set(visible);
    const firstHidden = entries.find(
      (entry) =>
        !shown.has(entry) &&
        (category === "all" || entry.category === category),
    );
    flushSync(() => setShowOlder(true));
    if (firstHidden) {
      document.getElementById(`entry-${firstHidden.id}-title`)?.focus();
    }
  };

  return (
    <div className="mx-auto flex w-full max-w-3xl flex-col gap-10">
      {categories.length > 1 && (
        <div
          role="group"
          aria-label={t("filter.label")}
          className="-mb-4 flex flex-wrap gap-2"
        >
          {(["all", ...categories] as const).map((value) => {
            const pressed = value === category;
            const Icon =
              value === "all" ? undefined : CATEGORY_META[value].icon;
            return (
              <Button
                key={value}
                type="button"
                size="sm"
                variant={pressed ? "default" : "outline"}
                aria-pressed={pressed}
                onClick={() => setCategory(value)}
                className={cn(
                  "rounded-full",
                  TOUCH_TARGET,
                  pressed &&
                    "bg-jigsaw-primary hover:bg-jigsaw-primary/90 text-white",
                )}
              >
                {Icon && <Icon aria-hidden />}
                {value === "all" ? t("filter.all") : t(`category.${value}`)}
              </Button>
            );
          })}
        </div>
      )}
      {groupByMonth(visible).map((group) => {
        const headingId = `m-${group.key}`;
        return (
          <section key={group.key} aria-labelledby={headingId}>
            <h2
              id={headingId}
              className="text-muted-foreground mb-4 flex items-center gap-3 font-mono text-[11px] font-medium tracking-[0.09em] uppercase"
            >
              {format.dateTime(new Date(group.monthStart), {
                month: "long",
                year: "numeric",
                timeZone: "UTC",
              })}
              <span aria-hidden className="bg-border h-px flex-1" />
            </h2>
            <ol className="flex flex-col gap-4">
              {group.entries.map((entry) => (
                <li key={entry.id}>
                  <EntryCard
                    entry={entry}
                    unread={unread.has(entry.id)}
                    open={unread.has(entry.id) || entry.id === deepLinkId}
                    tours={tours}
                  />
                </li>
              ))}
            </ol>
          </section>
        );
      })}
      {olderCount > 0 && (
        <Button
          type="button"
          variant="outline"
          onClick={revealOlder}
          className={cn("-mt-4 self-center", TOUCH_TARGET)}
        >
          <ChevronDown aria-hidden />
          {t("showOlder", { count: olderCount })}
        </Button>
      )}
    </div>
  );
}

function EntryCard({
  entry,
  unread,
  open,
  tours,
}: {
  entry: WhatsNewEntry;
  unread: boolean;
  /** Start with the image and body shown (unread or deep-linked). */
  open: boolean;
  tours: readonly WhatsNewTourProgressView[] | undefined;
}) {
  const t = useTranslations("whatsNew");
  const format = useFormatter();
  const content = contentFor(entry, useLocale());
  const { startTour } = useTourLauncher();
  const titleId = `entry-${entry.id}-title`;
  const tour = entry.tour;
  const cta =
    entry.ctaTo && content.ctaLabel
      ? { to: entry.ctaTo, label: content.ctaLabel }
      : undefined;

  return (
    <article
      id={`entry-${entry.id}`}
      aria-labelledby={titleId}
      className="scroll-mt-20"
    >
      <Card
        className={cn(
          "gap-3 p-5 sm:p-6",
          unread &&
            "border-primary/30 bg-jigsaw-primary/5 dark:bg-jigsaw-primary/10",
        )}
      >
        <div className="flex flex-wrap items-center gap-2 text-sm">
          <CategoryChip category={entry.category} />
          <time
            dateTime={isoDateUtc(entry.publishedAt)}
            className="text-muted-foreground"
          >
            {format.dateTime(new Date(entry.publishedAt), {
              dateStyle: "medium",
              timeZone: "UTC",
            })}
          </time>
          {unread && (
            <span
              className={cn(
                "ml-auto rounded-full px-2 py-0.5 text-[11px] font-semibold tracking-wide uppercase",
                COUNT_PILL_COLORS,
              )}
            >
              {t("new")}
            </span>
          )}
        </div>
        {/* tabIndex -1: a #entry-{id} deep link moves focus here (see the route). */}
        <h3
          id={titleId}
          tabIndex={-1}
          className="font-heading text-card-foreground text-xl leading-tight font-semibold focus-visible:outline-none"
        >
          {unread && <span className="sr-only">{`${t("newPrefix")} `}</span>}
          {content.title}
        </h3>
        <p className="text-muted-foreground">{content.summary}</p>
        {(entry.image || content.html) && (
          // The summary is always visible; the image and full body sit behind "Read more". `open`
          // only sets the starting state: the member can still fold or unfold any card.
          <details open={open} className="group/body">
            <summary
              aria-describedby={titleId}
              className={cn(
                "text-primary-text inline-flex cursor-pointer list-none items-center gap-1 rounded-sm text-sm font-medium underline-offset-2 hover:underline [&::-webkit-details-marker]:hidden",
                "focus-visible:ring-ring/50 outline-none focus-visible:ring-[3px]",
                TOUCH_TARGET,
              )}
            >
              <span className="group-open/body:hidden">{t("readMore")}</span>
              <span className="hidden group-open/body:inline">
                {t("showLess")}
              </span>
              <ChevronDown
                aria-hidden
                className="size-4 transition-transform group-open/body:rotate-180 motion-reduce:transition-none"
              />
            </summary>
            <div className="mt-3 flex flex-col gap-3">
              {entry.image && (
                // eslint-disable-next-line @next/next/no-img-element
                <img
                  src={entry.image}
                  alt={content.imageAlt ?? ""}
                  loading="lazy"
                  decoding="async"
                  className="bg-muted aspect-video w-full rounded-lg border object-cover"
                />
              )}
              {content.html && (
                <div
                  className={WHATS_NEW_PROSE}
                  // Rendered at build time from Markdown in the repo (docs/whats-new), not user input.
                  dangerouslySetInnerHTML={{ __html: content.html }}
                />
              )}
            </div>
          </details>
        )}
        {(tour || cta) && (
          <div className="flex flex-col flex-wrap gap-2 pt-1 sm:flex-row">
            {tour && (
              <TourButtons
                tourId={tour}
                tours={tours}
                onStart={(returnFocus, restart) =>
                  startTour(tour, { returnFocus, restart })
                }
              />
            )}
            {cta && (
              <Button
                asChild
                variant={tour ? "outline" : "default"}
                className={cn(
                  "w-full sm:w-auto",
                  !tour &&
                    "bg-jigsaw-primary hover:bg-jigsaw-primary/90 text-white",
                )}
              >
                <Link href={cta.to}>
                  {cta.label}
                  {tour && <ArrowRight aria-hidden />}
                </Link>
              </Button>
            )}
          </div>
        )}
      </Card>
    </article>
  );
}

// Primary: take / resume / replay; "Start over" next to it while a tour is paused (Part B §1.7).
function TourButtons({
  tourId,
  tours,
  onStart,
}: {
  tourId: string;
  tours: readonly WhatsNewTourProgressView[] | undefined;
  onStart: (returnFocus: HTMLElement, restart: boolean) => void;
}) {
  const t = useTranslations("whatsNew");
  const { label, resumable } = useTourButton(tourId, tours);
  return (
    <>
      <Button
        className="bg-jigsaw-primary hover:bg-jigsaw-primary/90 w-full text-white sm:w-auto"
        onClick={(event) => onStart(event.currentTarget, false)}
      >
        <Compass aria-hidden />
        {label}
      </Button>
      {resumable && (
        <Button
          variant="ghost"
          size="sm"
          className="w-full self-center sm:w-auto"
          onClick={(event) => onStart(event.currentTarget, true)}
        >
          {t("tour.restart")}
        </Button>
      )}
    </>
  );
}

function EmptyState() {
  const t = useTranslations("whatsNew.empty");
  return (
    <div className="mx-auto w-full max-w-3xl">
      <Card>
        <CardContent className="p-12 text-center">
          <div className="bg-muted mx-auto mb-4 flex size-16 items-center justify-center rounded-full">
            <Sparkles aria-hidden className="text-muted-foreground size-8" />
          </div>
          <h2 className="mb-2 text-lg font-medium">{t("title")}</h2>
          <p className="text-muted-foreground text-sm">{t("body")}</p>
        </CardContent>
      </Card>
    </div>
  );
}
