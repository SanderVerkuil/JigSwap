"use client";

import { Link } from "@/compat/link";
import { usePageHeaderActions } from "@/components/dashboard-layout/page-header-slot";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { gateway } from "@/gateway";
import { useUrlTextDraft } from "@/hooks/use-url-text-draft";
import {
  activeFacetCount,
  catalogueEmptyState,
  catalogueSearchArgs,
  favouritesInCatalogue,
  hasActiveCatalogueFilters,
} from "@/lib/catalogue-filters";
import {
  facetSearch,
  filtersFromSearch,
  type PuzzlesSearch,
} from "@/lib/puzzles-search";
import { convexQuery } from "@convex-dev/react-query";
import { useQuery } from "@tanstack/react-query";
// sanctioned convex/react exception: usePaginatedQuery (see tanstack-query migration spec)
import { usePaginatedQuery } from "convex/react";
import { Filter, Heart, Plus, Search, X } from "lucide-react";
import {
  useCallback,
  useEffect,
  useId,
  useMemo,
  useRef,
  useState,
} from "react";
import { useTranslations } from "use-intl";
import { ActiveFacetChips } from "./active-facet-chips";
import { PuzzleCard } from "./puzzle-card";
import { PuzzleCardSkeleton } from "./puzzle-card-skeleton";
import { PuzzleFilters } from "./puzzle-filters";
import { PuzzleViewProvider } from "./puzzle-view-provider";
import { ToolbarSearch } from "./toolbar-search";
import { ViewModeToggle } from "./view-mode-toggle";

const PAGE_SIZE = 20;
const SEARCH_DEBOUNCE_MS = 300;
// Upper bound on the rows a returning visit asks for in one go.
const MAX_RESTORED_ROWS = 120;

// How many rows each search had loaded when the member last left it. Coming Back to the same search
// asks for that many at once and draws as many placeholders, so the page is tall enough for the
// router's scroll restoration to land where the member was. In memory only: a reload starts afresh.
const loadedRows = new Map<string, number>();
// Whether the member last left the Filters panel open for each search, for the same reason: the
// panel is part of the page's height.
const filterPanelChoices = new Map<string, boolean>();

interface PuzzlesClientProps {
  /** The validated /puzzles URL state: term, filters, favourites and view mode. */
  search: PuzzlesSearch;
  /** Updates the URL state; receives the latest state so quick successive edits all land. */
  onSearchChange: (update: (prev: PuzzlesSearch) => PuzzlesSearch) => void;
  className?: string;
}

export function PuzzlesClient({
  search,
  onSearchChange,
  className = "",
}: PuzzlesClientProps) {
  const t = useTranslations("puzzles.puzzles");
  const tPuzzles = useTranslations("puzzles");

  const viewMode = search.view ?? "grid";
  const favoritesOnly = search.fav === true;
  const filters = filtersFromSearch(search);
  const filtersPanelId = useId();
  // Clearing remounts the panel, so a range value still waiting for its pause goes with the rest.
  const [filtersPanelKey, setFiltersPanelKey] = useState(0);

  // The search box edits a draft that follows the URL; the URL (and so the server query) takes it
  // over after a pause in typing, so every keystroke doesn't start a new search. A term changed
  // from elsewhere (the sidebar's link to the bare catalogue) replaces the draft.
  const searchBox = useUrlTextDraft(
    search.q,
    (q) => onSearchChange((prev) => ({ ...prev, q })),
    SEARCH_DEBOUNCE_MS,
  );
  const searchDraft = searchBox.draft;

  // The catalogue is searched and filtered on the server, so matches beyond the loaded pages are
  // found. Favourites are a short, complete list: the same facets apply to it on the client.
  const searchArgs = catalogueSearchArgs(filters);
  const searchKey = JSON.stringify(searchArgs);
  // Open from the start when a facet is set (a shared link), so the member can see what narrows the
  // results; the term and favourites show in the toolbar either way. A member who opened or closed
  // the panel for this search finds it that way again.
  const [showFilters, setShowFilters] = useState(
    () =>
      filterPanelChoices.get(searchKey) ??
      hasActiveCatalogueFilters({ ...filters, searchTerm: "" }),
  );
  const remembered = Math.min(
    loadedRows.get(searchKey) ?? 0,
    MAX_RESTORED_ROWS,
  );
  const catalogue = usePaginatedQuery(
    gateway.catalog.search,
    favoritesOnly ? "skip" : searchArgs,
    { initialNumItems: Math.max(remembered, PAGE_SIZE) },
  );
  // The read drops its rows as soon as the arguments change. The last finished rows stay on screen,
  // dimmed, until the new search's first page arrives, so a facet change doesn't collapse the grid.
  const [settledRows, setSettledRows] = useState(catalogue.results);
  if (
    catalogue.status !== "LoadingFirstPage" &&
    settledRows !== catalogue.results
  ) {
    setSettledRows(catalogue.results);
  }
  const showingSettledRows =
    !favoritesOnly &&
    catalogue.status === "LoadingFirstPage" &&
    settledRows.length > 0;
  const loadedCount = catalogue.results.length;
  useEffect(() => {
    if (!favoritesOnly && loadedCount > 0) {
      loadedRows.set(searchKey, loadedCount);
    }
  }, [favoritesOnly, searchKey, loadedCount]);
  const { data: favourites } = useQuery(
    convexQuery(gateway.catalog.listMyFavorites, favoritesOnly ? {} : "skip"),
  );
  // What the member already has a copy of, so they can scan the catalogue for what they're missing.
  const { data: ownedIds } = useQuery(
    convexQuery(gateway.library.myOwnedDefinitionIds, {}),
  );
  const ownedDefinitionIds = useMemo(() => new Set(ownedIds), [ownedIds]);
  const puzzles = favoritesOnly
    ? favouritesInCatalogue(favourites ?? [], searchArgs)
    : showingSettledRows
      ? settledRows
      : catalogue.results;
  // "loading": nothing to show yet; "partial": more matches can still load; "complete": all are in.
  const listState: "loading" | "partial" | "complete" = favoritesOnly
    ? favourites === undefined
      ? "loading"
      : "complete"
    : catalogue.status === "LoadingFirstPage"
      ? "loading"
      : catalogue.status === "Exhausted"
        ? "complete"
        : "partial";

  const observerRef = useRef<HTMLDivElement>(null);
  const { status, loadMore } = catalogue;

  // Infinite scroll implementation
  const handleObserver = useCallback(
    (entries: IntersectionObserverEntry[]) => {
      const [target] = entries;
      if (target.isIntersecting && status === "CanLoadMore") {
        loadMore(PAGE_SIZE);
      }
    },
    [loadMore, status],
  );

  useEffect(() => {
    const element = observerRef.current;
    if (!element) return;

    const observer = new IntersectionObserver(handleObserver, {
      root: null,
      rootMargin: "20px",
      threshold: 0.1,
    });

    observer.observe(element);
    return () => observer.unobserve(element);
  }, [handleObserver]);

  const applyFacets = (patch: Partial<typeof filters>) =>
    onSearchChange((prev) => ({
      ...prev,
      ...facetSearch({ ...filtersFromSearch(prev), ...patch }),
    }));

  const clearFilters = () => {
    searchBox.change("");
    setFiltersPanelKey((key) => key + 1);
    // Everything but the view mode.
    onSearchChange((prev) => ({ view: prev.view }));
  };

  const facetCount = activeFacetCount(filters);
  // A removed chip's button unmounts with it: focus moves here first, so keyboard and screen-reader
  // users stay in the toolbar instead of restarting from the top of the page.
  const filtersToggleRef = useRef<HTMLButtonElement>(null);

  const hasActiveFilters =
    favoritesOnly ||
    searchDraft.trim() !== "" ||
    hasActiveCatalogueFilters(filters);
  // What an exhausted, empty result says: only a term or filter is worth blaming.
  const emptyState = catalogueEmptyState({
    favoritesOnly,
    hasFilters: hasActiveCatalogueFilters(filters),
  });

  // The title/subtitle live in the shared shell page head (via route-meta); publish only the
  // "contribute to catalogue" action there so the body carries no own header. The result count
  // sits once, in the toolbar next to the filters below, rather than repeating in the head. It is
  // an outline button named after the page it opens: contributing adds a puzzle to the shared
  // catalogue, not a copy to the member's own puzzles (that is each card's +).
  usePageHeaderActions(
    () => (
      <Button size="sm" variant="outline" asChild>
        <Link href="/puzzles/add">
          <Plus className="h-4 w-4" />
          {tPuzzles("contributePuzzle")}
        </Link>
      </Button>
    ),
    [tPuzzles],
  );

  return (
    <div className={`space-y-6 ${className}`}>
      {/* Filters and Search */}
      <div>
        {/* Wraps by the toolbar's own width, not the viewport (the sidebar narrows the column on
              a tablet): see ToolbarSearch. */}
        <div className="flex flex-wrap gap-4">
          <ToolbarSearch
            label={t("searchLabel")}
            placeholder={t("searchPlaceholder")}
            value={searchDraft}
            onChange={searchBox.change}
          />

          <div className="flex flex-wrap gap-4">
            {/* Favorites Toggle */}
            <Button
              variant={favoritesOnly ? "default" : "outline"}
              aria-pressed={favoritesOnly}
              onClick={() =>
                onSearchChange((prev) => ({
                  ...prev,
                  fav: prev.fav ? undefined : true,
                }))
              }
              className="flex items-center gap-2"
            >
              <Heart className="h-4 w-4" />
              {t("favoritesOnly")}
            </Button>

            {/* Filter Toggle: looks pressed while open or while facets narrow the results, and
                  counts them, so a closed panel can't hide what is filtering the list. */}
            <Button
              ref={filtersToggleRef}
              variant="outline"
              aria-expanded={showFilters}
              aria-controls={filtersPanelId}
              data-active={showFilters || facetCount > 0 ? "" : undefined}
              onClick={() => {
                filterPanelChoices.set(searchKey, !showFilters);
                setShowFilters(!showFilters);
              }}
              className="data-active:bg-accent data-active:text-accent-foreground dark:data-active:bg-accent flex items-center gap-2"
            >
              <Filter className="h-4 w-4" />
              {facetCount > 0
                ? t("filtersLabelCount", { count: facetCount })
                : t("filtersLabel")}
            </Button>

            {/* Clear Filters */}
            {hasActiveFilters && (
              <Button
                variant="ghost"
                onClick={clearFilters}
                className="flex items-center gap-2"
              >
                <X className="h-4 w-4" />
                {t("clearFilters")}
              </Button>
            )}
          </div>
        </div>

        {/* Advanced Filters: the wrapper always exists so the toggle's aria-controls resolves */}
        <div id={filtersPanelId}>
          {showFilters && (
            <PuzzleFilters
              key={filtersPanelKey}
              filters={filters}
              onFiltersChange={applyFacets}
              className="mt-4"
            />
          )}
        </div>
        {!showFilters && facetCount > 0 && (
          <ActiveFacetChips
            filters={filters}
            onRemove={(patch) => {
              filtersToggleRef.current?.focus();
              applyFacets(patch);
            }}
          />
        )}
      </div>

      {/* View Mode Toggle */}
      <div className="flex items-center justify-between">
        <ViewModeToggle
          value={viewMode}
          onChange={(mode) =>
            onSearchChange((prev) => ({
              ...prev,
              view: mode === "list" ? "list" : undefined,
            }))
          }
        />
        {/* One count, on every screen size: final once every match is in, "so far" while more
            can still load. */}
        {listState === "loading" ? (
          <Skeleton className="h-4 w-32" />
        ) : (
          <div className="text-sm text-muted-foreground">
            {listState === "complete"
              ? t("puzzlesFound", { count: puzzles.length })
              : t("puzzlesFoundSoFar", { count: puzzles.length })}
          </div>
        )}
      </div>

      {/* Puzzles Grid/List. "No puzzles" only once the search is exhausted; until then a match
          may still be on a later page. */}
      {puzzles.length > 0 ? (
        <div
          aria-busy={showingSettledRows}
          className={
            showingSettledRows
              ? "opacity-60 motion-safe:transition-opacity"
              : undefined
          }
        >
          <PuzzleViewProvider viewMode={viewMode}>
            {puzzles.map((puzzle) => (
              <PuzzleCard
                key={puzzle._id}
                puzzle={puzzle}
                onShelf={
                  !!puzzle.aggregateId &&
                  ownedDefinitionIds.has(puzzle.aggregateId)
                }
                headingLevel={2}
              />
            ))}
          </PuzzleViewProvider>
        </div>
      ) : listState === "complete" ? (
        <Card>
          <CardContent className="p-12 text-center">
            <div className="text-muted-foreground">
              <div className="w-16 h-16 mx-auto mb-4 rounded-full bg-muted flex items-center justify-center">
                {emptyState === "noFavourites" ? (
                  <Heart className="h-8 w-8" />
                ) : (
                  <Search className="h-8 w-8" />
                )}
              </div>
              {/* Level with the h2 card titles it stands in for. */}
              {emptyState === "filtered" ? (
                <>
                  <h2 className="text-lg font-medium mb-2">
                    {t("noPuzzlesFound")}
                  </h2>
                  <p className="text-sm">{t("tryDifferentFilters")}</p>
                  <Button
                    variant="outline"
                    onClick={clearFilters}
                    className="mt-4 text-foreground"
                  >
                    <X className="h-4 w-4" />
                    {t("clearFilters")}
                  </Button>
                </>
              ) : emptyState === "noFavourites" ? (
                <>
                  <h2 className="text-lg font-medium mb-2">
                    {t("noFavoritesTitle")}
                  </h2>
                  <p className="text-sm">{t("noFavoritesHint")}</p>
                  <Button
                    variant="outline"
                    onClick={() =>
                      onSearchChange((prev) => ({ ...prev, fav: undefined }))
                    }
                    className="mt-4 text-foreground"
                  >
                    {t("showAllPuzzles")}
                  </Button>
                </>
              ) : (
                <>
                  <h2 className="text-lg font-medium mb-2">
                    {t("emptyCatalogueTitle")}
                  </h2>
                  <p className="text-sm">{t("emptyCatalogueHint")}</p>
                  <Button asChild className="mt-4">
                    <Link href="/puzzles/add">
                      <Plus className="h-4 w-4" />
                      {tPuzzles("contributePuzzle")}
                    </Link>
                  </Button>
                </>
              )}
            </div>
          </CardContent>
        </Card>
      ) : null}

      {/* Infinite Scroll Observer: above the placeholders, so it is in view (and keeps loading)
          when the first pages hold no match yet. */}
      <div ref={observerRef} className="h-4" />

      {puzzles.length === 0 && listState !== "complete" && (
        <PuzzleViewProvider viewMode={viewMode}>
          {Array.from({ length: remembered || PAGE_SIZE / 2 }, (_, i) => (
            <PuzzleCardSkeleton key={i} />
          ))}
        </PuzzleViewProvider>
      )}

      {/* Loading More Indicator */}
      {status === "LoadingMore" && puzzles.length > 0 && (
        <div className="flex justify-center py-4">
          <div className="animate-spin rounded-full h-6 w-6 border-b-2 border-primary"></div>
        </div>
      )}
    </div>
  );
}
