"use client";

import { Image } from "@/compat/image";
import { Link } from "@/compat/link";
import { SegmentedPills } from "@/components/add-puzzle/segmented-pills";
import { SectionHead } from "@/components/dashboard-home/section-head";
import { Button } from "@/components/ui/button";
import { PuzzleCard, PuzzleViewProvider } from "@/components/ui/puzzle-card";
import { gateway, Id } from "@/gateway";
import {
  formatCompletionDate,
  formatSolveTime,
  hrefForLink,
} from "@/lib/completion-format";
import { cn } from "@/lib/utils";
// sanctioned convex/react exception: usePaginatedQuery (see tanstack-query migration spec)
import { usePaginatedQuery } from "convex/react";
import { CircleCheck, Puzzle } from "lucide-react";
import { useState } from "react";
import { useTranslations } from "use-intl";

// A member's puzzles and finished solves on their profile page. Both reads are auth-gated and
// visibility-gated server-side (social/listProfileCopies, social/listProfileCompletions), so the
// caller only mounts these for a signed-in viewer of an unlocked profile. Convex pagination with a
// "Show more" button; a section with nothing visible renders nothing.

const PAGE_SIZE = 12;

function ShowMore({
  status,
  onClick,
  label,
}: {
  status: string;
  onClick: () => void;
  label: string;
}) {
  if (status !== "CanLoadMore" && status !== "LoadingMore") return null;
  return (
    <div className="mt-4 flex justify-center">
      <Button
        variant="outline"
        size="sm"
        disabled={status === "LoadingMore"}
        onClick={onClick}
      >
        {label}
      </Button>
    </div>
  );
}

type PuzzlesFilter = "all" | "available";

// `scope` is the server-computed libraryScope (getPublicProfile): "all" — the viewer sees the whole
// library (self, household mate, mutual follower) and may narrow it to the available copies;
// "available" — the server only ever returns the copies offered to swap/lend/sell, so the section
// says so (the "N owned" stat counts every copy).
export function ProfilePuzzlesSection({
  memberId,
  firstName,
  scope,
}: {
  memberId: Id<"users">;
  firstName: string;
  scope: "all" | "available";
}) {
  const t = useTranslations("profile.puzzles");
  const [filter, setFilter] = useState<PuzzlesFilter>("all");
  const effective: PuzzlesFilter = scope === "all" ? filter : "available";
  const { results, status, loadMore } = usePaginatedQuery(
    gateway.social.profileCopies,
    { memberId, filter: effective },
    { initialNumItems: PAGE_SIZE },
  );
  const empty = results.length === 0 && status !== "CanLoadMore";
  // A page can come back short (even empty) when copies fail the per-copy gate, so an empty first
  // page that can still load more keeps the section (and its Show more) visible. Once the viewer
  // has narrowed the list, the section (and its filter) stays put so they can widen it again.
  if (empty && !(scope === "all" && filter === "available")) return null;
  return (
    // `puzzles` is the anchor a grouped "added N puzzles" feed entry links to.
    <section id="puzzles" className="scroll-mt-20">
      <SectionHead title={t("title", { name: firstName })} icon={Puzzle} />
      {scope === "all" && (
        <div className="mb-4">
          <SegmentedPills
            options={[
              { value: "all", label: t("filterAll") },
              { value: "available", label: t("filterAvailable") },
            ]}
            value={filter}
            onChange={setFilter}
            ariaLabel={t("filterLabel", { name: firstName })}
          />
        </div>
      )}
      {effective === "available" && (
        <p className="text-muted-foreground mb-4 text-sm">
          {empty && status === "Exhausted"
            ? t("emptyAvailable", { name: firstName })
            : t("availableNote", { name: firstName })}
        </p>
      )}
      {/* The provider renders the app's shared auto-fill puzzle grid; cards are its direct children. */}
      <PuzzleViewProvider viewMode="grid">
        {results.map((copy) => (
          <PuzzleCard
            key={copy._id}
            puzzle={copy}
            showActions={false}
            imageFit="contain"
          />
        ))}
      </PuzzleViewProvider>
      <ShowMore
        status={status}
        onClick={() => loadMore(PAGE_SIZE)}
        label={t("showMore")}
      />
    </section>
  );
}

export function ProfileCompletionsSection({
  memberId,
  firstName,
}: {
  memberId: Id<"users">;
  firstName: string;
}) {
  const t = useTranslations("profile.completions");
  const tLog = useTranslations("solving.completions");
  const { results, status, loadMore } = usePaginatedQuery(
    gateway.social.profileCompletions,
    { memberId },
    { initialNumItems: PAGE_SIZE },
  );
  if (results.length === 0) return null;
  return (
    <section>
      <SectionHead title={t("title", { name: firstName })} icon={CircleCheck} />
      <div className="flex flex-col">
        {results.map((completion, index) => {
          const title = completion.title ?? t("untitled");
          const meta = [
            completion.pieceCount !== undefined &&
              t("pieces", { count: completion.pieceCount }),
            completion.datePrecision === "day"
              ? tLog("finished", {
                  date: new Date(completion.endDate).toLocaleDateString(),
                })
              : formatCompletionDate(tLog, completion),
            completion.completionTimeMinutes !== undefined &&
              formatSolveTime(tLog, completion.completionTimeMinutes),
          ]
            .filter(Boolean)
            .join(" · ");
          return (
            <div
              key={completion._id}
              className={cn(
                "flex items-start gap-3.5 py-3",
                index < results.length - 1 && "border-b",
              )}
            >
              {completion.thumbnailUrl ? (
                <Image
                  src={completion.thumbnailUrl}
                  alt=""
                  width={44}
                  height={44}
                  className="h-11 w-11 shrink-0 rounded-md border bg-muted object-contain"
                />
              ) : (
                <span className="bg-muted flex h-11 w-11 shrink-0 items-center justify-center rounded-md">
                  <Puzzle className="text-muted-foreground h-5 w-5" />
                </span>
              )}
              <div className="min-w-0 flex-1">
                {completion.link ? (
                  <Link
                    href={hrefForLink(completion.link)}
                    className="block truncate text-sm font-semibold hover:underline"
                  >
                    {title}
                  </Link>
                ) : (
                  <p className="truncate text-sm font-semibold">{title}</p>
                )}
                <p className="text-muted-foreground text-xs">{meta}</p>
                {completion.photoUrls.length > 0 && (
                  <div className="mt-1.5 flex flex-wrap gap-1.5">
                    {completion.photoUrls.map((url) => (
                      <a
                        key={url}
                        href={url}
                        target="_blank"
                        rel="noreferrer"
                        aria-label={title}
                      >
                        <Image
                          src={url}
                          alt=""
                          width={44}
                          height={44}
                          className="h-11 w-11 rounded-md border bg-muted object-cover"
                        />
                      </a>
                    ))}
                  </div>
                )}
              </div>
            </div>
          );
        })}
      </div>
      <ShowMore
        status={status}
        onClick={() => loadMore(PAGE_SIZE)}
        label={t("showMore")}
      />
    </section>
  );
}
