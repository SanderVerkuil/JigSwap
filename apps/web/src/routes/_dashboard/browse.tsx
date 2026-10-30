import { useUser } from "@/compat/clerk";
import { PuzzleFilterChip } from "@/components/browse/puzzle-filter-chip";
import {
  EMPTY_QUERY,
  QueryBuilder,
  type CategoryOption,
  type QueryBuilderState,
} from "@/components/browse/query-builder";
import {
  browseFilterArgs,
  useBrowsePages,
} from "@/components/browse/use-browse-pages";
import { EmptyState } from "@/components/community/primitives";
import { canRequestTrade } from "@/components/exchange/request-trade";
import {
  RequestTradeDialog,
  type RequestableCopy,
} from "@/components/exchange/request-trade-dialog";
import {
  copyMessageRoute,
  isOwnCopy,
} from "@/components/messaging/copy-conversation";
import { PuzzleCardSkeleton } from "@/components/puzzles/puzzle-card-skeleton";
import { ViewModeToggle } from "@/components/puzzles/view-mode-toggle";
import { Button } from "@/components/ui/button";
import { PageLoading } from "@/components/ui/loading";
import { PuzzleCard, PuzzleViewProvider } from "@/components/ui/puzzle-card";
import { Skeleton } from "@/components/ui/skeleton";
import { gateway } from "@/gateway";
import { validateBrowseSearch } from "@/lib/browse-search";
import { useProjectedMemberName } from "@/lib/member-display-name";
import { pageTitle } from "@/lib/page-title";
import { convexQuery } from "@convex-dev/react-query";
import { useQuery } from "@tanstack/react-query";
import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useEffect, useMemo, useState } from "react";
import { toast } from "sonner";
import { useTranslations } from "use-intl";

export const Route = createFileRoute("/_dashboard/browse")({
  // `?puzzle=<definitionId>` narrows Browse to copies of one catalogue puzzle (the catalogue's
  // "Find a copy to swap" CTA). Kept in the URL so back/forward and shared links keep the filter.
  validateSearch: validateBrowseSearch,
  head: ({ match }) => ({
    meta: [{ title: pageTitle(match.context, "browse") }],
  }),
  pendingComponent: () => <BrowsePending />,
  component: BrowsePage,
});

function BrowsePending() {
  const tCommon = useTranslations("common");
  return <PageLoading message={tCommon("loading")} />;
}

function BrowsePage() {
  const navigate = useNavigate();
  const { puzzle: puzzleFilter } = Route.useSearch();
  const { user } = useUser();
  const t = useTranslations("puzzles");
  const tCommon = useTranslations("common");
  const tBrowse = useTranslations("browse");
  const tCopyOwner = useTranslations("copyOwner");
  const projectedName = useProjectedMemberName();

  const [viewMode, setViewMode] = useState<"grid" | "list">("grid");
  const [query, setQuery] = useState<QueryBuilderState>(EMPTY_QUERY);
  const [requestCopy, setRequestCopy] = useState<RequestableCopy | null>(null);

  // Debounce the free-text condition (~200ms) so typing narrows results without
  // refetching the browse query on every keystroke. Every other condition is
  // applied immediately. `debouncedText` is what we actually send to the server.
  const [debouncedText, setDebouncedText] = useState("");
  useEffect(() => {
    const handle = setTimeout(() => setDebouncedText(query.text.trim()), 200);
    return () => clearTimeout(handle);
  }, [query.text]);

  const { data: convexUser } = useQuery(
    convexQuery(
      gateway.identity.byClerkId,
      user?.id ? { clerkId: user.id } : "skip",
    ),
  );

  // Every condition (availability included) and the free-text searchTerm (matched over title /
  // brand / description / tags) is applied by gateway.library.browseOwned before paging, so the
  // total and "Load more" cover every matching offer, not just the first page.
  const browse = useBrowsePages(
    browseFilterArgs(query, debouncedText, puzzleFilter),
  );

  const { data: categoriesRaw } = useQuery(
    convexQuery(gateway.catalog.puzzleCategories, {}),
  );

  const categories: CategoryOption[] = useMemo(
    () =>
      (categoriesRaw ?? []).map((category) => ({
        id: category._id,
        name: category.name.en,
      })),
    [categoriesRaw],
  );

  // Only the member lookup gates the page. Results load inside it, so the query builder stays
  // mounted (and the Text field keeps focus) while a new filter's results arrive.
  if (!user || convexUser === undefined) {
    return <PageLoading message={tCommon("loading")} />;
  }

  const shownPuzzles = browse.rows;

  return (
    <div className="flex flex-col gap-[18px]">
      {puzzleFilter && (
        <PuzzleFilterChip
          puzzleId={puzzleFilter}
          onRemove={() =>
            // Clearing a filter stays on the same page: keep the scroll position.
            navigate({ to: "/browse", search: {}, resetScroll: false })
          }
        />
      )}
      {/* Query builder + result count + view toggle. Members compose multiple
          AND-combined conditions (one of them the free-text filter); the global
          ⌘K palette stays the quick known-item lookup. The shell owns the page
          title and width — no boxed card, no container wrapper here. */}
      <div
        className="flex flex-wrap items-start justify-between gap-3"
        data-tour="browse-filters"
      >
        <QueryBuilder
          value={query}
          onChange={setQuery}
          categories={categories}
          tBrowse={tBrowse}
          tEnum={t}
        />
        <div className="flex items-center gap-3">
          {/* The exact number of matching offers: "Showing x of y" while more can be loaded. */}
          {browse.total === undefined ? (
            browse.loading && <Skeleton className="h-4 w-28" />
          ) : (
            <span className="text-muted-foreground text-sm">
              {shownPuzzles.length < browse.total
                ? tBrowse("showingCount", {
                    shown: shownPuzzles.length,
                    total: browse.total,
                  })
                : tBrowse("resultsCount", { count: shownPuzzles.length })}
            </span>
          )}
          <ViewModeToggle value={viewMode} onChange={setViewMode} />
        </div>
      </div>

      {/* Results */}
      {browse.failed ? (
        <EmptyState
          title={tBrowse("loadFailed")}
          sub={tBrowse("loadFailedHint")}
        />
      ) : browse.loading ? (
        <PuzzleViewProvider viewMode={viewMode}>
          {Array.from({ length: 8 }, (_, i) => (
            <PuzzleCardSkeleton key={i} />
          ))}
        </PuzzleViewProvider>
      ) : shownPuzzles.length === 0 && !browse.stale ? (
        <EmptyState
          title={tBrowse("noPuzzlesFound")}
          sub={tBrowse("tryDifferentFilters")}
        />
      ) : (
        // While a new filter's results load, the previous ones stay, dimmed and marked busy.
        <div
          aria-busy={browse.stale}
          className={
            browse.stale
              ? "opacity-60 motion-safe:transition-opacity"
              : undefined
          }
        >
          <PuzzleViewProvider viewMode={viewMode}>
            {shownPuzzles.map((puzzle) => {
              // The owner is privacy-projected: `ownerId` is present only when the owner is
              // revealed. An anonymised owner can still receive a trade request (propose derives
              // the recipient server-side, #144) but can't be messaged from here (the copy page
              // applies the same rule).
              const { ownerId, owner } = puzzle;
              return (
                <PuzzleCard
                  key={puzzle._id}
                  puzzle={puzzle}
                  variant="browse"
                  ownerLabel={projectedName(owner, tCopyOwner("anonymous"))}
                  onView={(ownedPuzzleId) =>
                    navigate({
                      to: "/copies/$id",
                      params: { id: ownedPuzzleId },
                    })
                  }
                  onRequestExchange={
                    canRequestTrade(puzzle, convexUser?._id)
                      ? () =>
                          setRequestCopy({
                            copyId: puzzle._id,
                            ...(ownerId !== undefined ? { ownerId } : {}),
                            owner: owner.anonymous ? null : owner.member,
                            title: puzzle.puzzle?.title ?? "",
                            pieceCount: puzzle.puzzle?.pieceCount,
                            coverUrl: puzzle.coverUrl,
                            availability: puzzle.availability,
                          })
                      : undefined
                  }
                  onMessage={
                    ownerId === undefined || isOwnCopy(ownerId, convexUser?._id)
                      ? undefined
                      : (ownedPuzzleId) =>
                          navigate(copyMessageRoute(ownedPuzzleId))
                  }
                  onFavorite={() => toast(tBrowse("favoritesComingSoon"))}
                />
              );
            })}
          </PuzzleViewProvider>
        </div>
      )}

      {/* aria-disabled, not disabled, while the next page loads: a disabled button drops focus. */}
      {(browse.hasMore || browse.loadingMore) && (
        <Button
          variant="outline"
          className="h-11 self-center md:h-9"
          aria-disabled={browse.loadingMore}
          onClick={() => {
            if (!browse.loadingMore) browse.loadMore();
          }}
        >
          {browse.loadingMore ? tCommon("loading") : tBrowse("loadMore")}
        </Button>
      )}

      <RequestTradeDialog
        copy={requestCopy}
        onOpenChange={(open) => {
          if (!open) setRequestCopy(null);
        }}
      />
    </div>
  );
}
