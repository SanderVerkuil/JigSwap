"use client";

import { Link } from "@/compat/link";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { cn } from "@/lib/utils";
import type { WhatsNewEntry } from "@/whats-new/types";
import { ArrowRight, Compass, Sparkles } from "lucide-react";
import { useFormatter, useLocale, useTranslations } from "use-intl";
import { CategoryChip, COUNT_PILL_COLORS } from "./category-chip";
import { contentFor, groupByMonth, isoDateUtc } from "./logic";
import { WHATS_NEW_PROSE } from "./prose";
import { useTourLauncher } from "./tour-launcher";

// The /whats-new reading column (spec Part B §1): one section per UTC month, newest first, each an
// ordered list of entry cards. `unreadIds` is the snapshot taken when the page mounted, or
// undefined while the read state loads: the cards render without pills until then (entries are
// bundled, so there is no skeleton).
export function WhatsNewList({
  entries,
  unreadIds,
}: {
  entries: readonly WhatsNewEntry[];
  unreadIds: readonly string[] | undefined;
}) {
  const format = useFormatter();

  if (entries.length === 0) return <EmptyState />;

  const unread = new Set(unreadIds);
  return (
    <div className="mx-auto flex w-full max-w-3xl flex-col gap-10">
      {groupByMonth(entries).map((group) => {
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
                  <EntryCard entry={entry} unread={unread.has(entry.id)} />
                </li>
              ))}
            </ol>
          </section>
        );
      })}
    </div>
  );
}

function EntryCard({
  entry,
  unread,
}: {
  entry: WhatsNewEntry;
  unread: boolean;
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
        {entry.image && (
          // eslint-disable-next-line @next/next/no-img-element
          <img
            src={entry.image}
            alt={content.imageAlt ?? ""}
            loading="lazy"
            decoding="async"
            className="bg-muted mt-1 aspect-video w-full rounded-lg border object-cover"
          />
        )}
        {content.html && (
          <div
            className={cn("mt-1", WHATS_NEW_PROSE)}
            // Rendered at build time from Markdown in the repo (docs/whats-new), not user input.
            dangerouslySetInnerHTML={{ __html: content.html }}
          />
        )}
        {(tour || cta) && (
          <div className="flex flex-col flex-wrap gap-2 pt-1 sm:flex-row">
            {tour && (
              <Button
                className="bg-jigsaw-primary hover:bg-jigsaw-primary/90 w-full text-white sm:w-auto"
                onClick={(event) =>
                  startTour(tour, { returnFocus: event.currentTarget })
                }
              >
                <Compass aria-hidden />
                {t("tour.take")}
              </Button>
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
