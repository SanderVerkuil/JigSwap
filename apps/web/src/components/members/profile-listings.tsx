"use client";

import { Image } from "@/compat/image";
import { Link } from "@/compat/link";
import { SectionHead } from "@/components/dashboard-home/section-head";
import { Button } from "@/components/ui/button";
import { PuzzleCard, PuzzleViewProvider } from "@/components/ui/puzzle-card";
import { gateway, Id } from "@/gateway";
import { formatSolveTime, hrefForLink } from "@/lib/completion-format";
import { cn } from "@/lib/utils";
// sanctioned convex/react exception: usePaginatedQuery (see tanstack-query migration spec)
import { usePaginatedQuery } from "convex/react";
import { CircleCheck, Puzzle } from "lucide-react";
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

export function ProfilePuzzlesSection({
  memberId,
  firstName,
}: {
  memberId: Id<"users">;
  firstName: string;
}) {
  const t = useTranslations("profile.puzzles");
  const { results, status, loadMore } = usePaginatedQuery(
    gateway.social.profileCopies,
    { memberId },
    { initialNumItems: PAGE_SIZE },
  );
  // A page can come back short (even empty) when copies fail the per-copy gate, so an empty first
  // page that can still load more keeps the section (and its Show more) visible.
  if (results.length === 0 && status !== "CanLoadMore") return null;
  return (
    <section>
      <SectionHead title={t("title", { name: firstName })} icon={Puzzle} />
      <PuzzleViewProvider viewMode="grid">
        <div className="grid grid-cols-2 gap-4 sm:grid-cols-3">
          {results.map((copy) => (
            <PuzzleCard
              key={copy._id}
              puzzle={copy}
              showActions={false}
              imageFit="contain"
            />
          ))}
        </div>
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
            tLog("finished", {
              date: new Date(completion.endDate).toLocaleDateString(),
            }),
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
