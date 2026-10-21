import { useUser } from "@/compat/clerk";
import { PuzzleFilterChip } from "@/components/browse/puzzle-filter-chip";
import {
  EMPTY_QUERY,
  QueryBuilder,
  type CategoryOption,
  type QueryBuilderState,
} from "@/components/browse/query-builder";
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
import { Button } from "@/components/ui/button";
import { PageLoading } from "@/components/ui/loading";
import { PuzzleCard, PuzzleViewProvider } from "@/components/ui/puzzle-card";
import { gateway, Id } from "@/gateway";
import { validateBrowseSearch } from "@/lib/browse-search";
import { useProjectedMemberName } from "@/lib/member-display-name";
import { pageTitle } from "@/lib/page-title";
import { convexQuery } from "@convex-dev/react-query";
import { useQuery } from "@tanstack/react-query";
import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { Grid, List } from "lucide-react";
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

  // Server-side filters: category, condition, difficulty, piece range, and the
  // free-text searchTerm (which the browse query matches over title / brand /
  // description / tags) are all honoured by gateway.library.browseOwned.
  const { data: browseOwnedPuzzlesResult } = useQuery(
    convexQuery(gateway.library.browseOwned, {
      category: query.category
        ? (query.category as Id<"adminCategories">)
        : undefined,
      difficulty: query.difficulty || undefined,
      condition: query.condition || undefined,
      minPieceCount: query.minPieces ? parseInt(query.minPieces) : undefined,
      maxPieceCount: query.maxPieces ? parseInt(query.maxPieces) : undefined,
      searchTerm: debouncedText || undefined,
      puzzleId: puzzleFilter,
      includeOwnPuzzles: false,
      limit: 50,
    }),
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

  // Client-side filter: per-availability-flag narrowing. The browse query only
  // prefilters to copies with ANY availability flag set, so selecting specific
  // channels (for trade / lend / sale) is filtered here over the returned rows.
  // TODO: a server-side `availability` arg on browseOwnedPuzzles would let this
  // run in the query and keep paging counts exact for large libraries.
  const shownPuzzles = useMemo(() => {
    const rows = browseOwnedPuzzlesResult?.ownedPuzzles ?? [];
    if (query.availability.length === 0) return rows;
    return rows.filter((puzzle) =>
      query.availability.some((flag) => puzzle.availability[flag]),
    );
  }, [browseOwnedPuzzlesResult, query.availability]);

  if (
    !user ||
    convexUser === undefined ||
    browseOwnedPuzzlesResult === undefined
  ) {
    return <PageLoading message={tCommon("loading")} />;
  }

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
          <span className="text-muted-foreground text-sm">
            {tBrowse("resultsCount", { count: shownPuzzles.length })}
          </span>
          <div className="flex items-center gap-1">
            <Button
              variant={viewMode === "grid" ? "secondary" : "ghost"}
              size="sm"
              onClick={() => setViewMode("grid")}
              aria-label={tBrowse("gridView")}
            >
              <Grid className="h-4 w-4" />
            </Button>
            <Button
              variant={viewMode === "list" ? "secondary" : "ghost"}
              size="sm"
              onClick={() => setViewMode("list")}
              aria-label={tBrowse("listView")}
            >
              <List className="h-4 w-4" />
            </Button>
          </div>
        </div>
      </div>

      {/* Results */}
      {shownPuzzles.length === 0 ? (
        <EmptyState
          title={tBrowse("noPuzzlesFound")}
          sub={tBrowse("tryDifferentFilters")}
        />
      ) : (
        <PuzzleViewProvider
          viewMode={viewMode}
          className={
            viewMode === "grid"
              ? "grid gap-[18px] [grid-template-columns:repeat(auto-fill,minmax(212px,1fr))]"
              : undefined
          }
        >
          {shownPuzzles.map((puzzle) => {
            // The owner is privacy-projected: `ownerId` is present only when the owner is revealed.
            // An anonymised owner can still receive a trade request (propose derives the recipient
            // server-side, #144) but can't be messaged from here (the copy page applies the same rule).
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
