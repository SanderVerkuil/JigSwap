"use client";

import { Link } from "@/compat/link";
import { usePageHeaderActions } from "@/components/dashboard-layout/page-header-slot";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { gateway } from "@/gateway";
import {
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
import { Filter, Grid, Heart, List, Plus, Search, X } from "lucide-react";
import { useCallback, useEffect, useId, useRef, useState } from "react";
import { useTranslations } from "use-intl";
import { PuzzleCard } from "./puzzle-card";
import { PuzzleCardSkeleton } from "./puzzle-card-skeleton";
import { PuzzleFilters } from "./puzzle-filters";
import { PuzzleViewProvider } from "./puzzle-view-provider";

const PAGE_SIZE = 20;
const SEARCH_DEBOUNCE_MS = 300;
// Upper bound on the rows a returning visit asks for in one go.
const MAX_RESTORED_ROWS = 120;

// How many rows each search had loaded when the member last left it. Coming Back to the same search
// asks for that many at once and draws as many placeholders, so the page is tall enough for the
// router's scroll restoration to land where the member was. In memory only: a reload starts afresh.
const loadedRows = new Map<string, number>();

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

  const viewMode = search.view ?? "grid";
  const favoritesOnly = search.fav === true;
  const filters = filtersFromSearch(search);
  const [showFilters, setShowFilters] = useState(false);
  const filtersPanelId = useId();

  // The search box edits a draft, seeded from the URL; the URL (and so the server query) takes it
  // over after a pause in typing, so every keystroke doesn't start a new search.
  const [searchDraft, setSearchDraft] = useState(search.q ?? "");
  const searchTimer = useRef<ReturnType<typeof setTimeout>>(undefined);
  useEffect(() => () => clearTimeout(searchTimer.current), []);
  const onSearchInput = (value: string) => {
    setSearchDraft(value);
    clearTimeout(searchTimer.current);
    searchTimer.current = setTimeout(
      () =>
        onSearchChange((prev) => ({ ...prev, q: value.trim() || undefined })),
      SEARCH_DEBOUNCE_MS,
    );
  };

  // The catalogue is searched and filtered on the server, so matches beyond the loaded pages are
  // found. Favourites are a short, complete list: the same facets apply to it on the client.
  const searchArgs = catalogueSearchArgs(filters);
  const searchKey = JSON.stringify(searchArgs);
  const remembered = Math.min(
    loadedRows.get(searchKey) ?? 0,
    MAX_RESTORED_ROWS,
  );
  const catalogue = usePaginatedQuery(
    gateway.catalog.search,
    favoritesOnly ? "skip" : searchArgs,
    { initialNumItems: Math.max(remembered, PAGE_SIZE) },
  );
  const loadedCount = catalogue.results.length;
  useEffect(() => {
    if (!favoritesOnly && loadedCount > 0) {
      loadedRows.set(searchKey, loadedCount);
    }
  }, [favoritesOnly, searchKey, loadedCount]);
  const { data: favourites } = useQuery(
    convexQuery(gateway.catalog.listMyFavorites, favoritesOnly ? {} : "skip"),
  );
  const puzzles = favoritesOnly
    ? favouritesInCatalogue(favourites ?? [], searchArgs)
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

  const clearFilters = () => {
    clearTimeout(searchTimer.current);
    setSearchDraft("");
    // Everything but the view mode.
    onSearchChange((prev) => ({ view: prev.view }));
  };

  const hasActiveFilters =
    favoritesOnly ||
    searchDraft.trim() !== "" ||
    hasActiveCatalogueFilters(filters);

  // The title/subtitle live in the shared shell page head (via route-meta); publish only the
  // "contribute to catalogue" action there so the body carries no own header. The result count
  // sits once, in the toolbar next to the filters below, rather than repeating in the head.
  usePageHeaderActions(
    () => (
      <Button size="sm" asChild>
        <Link href="/puzzles/add">
          <Plus className="h-4 w-4" />
          {t("addPuzzle")}
        </Link>
      </Button>
    ),
    [t],
  );

  return (
    <div className={`space-y-6 ${className}`}>
      {/* Filters and Search */}
      <Card>
        <CardContent>
          <div className="flex flex-col lg:flex-row gap-4">
            {/* Search */}
            <div className="flex-1 relative">
              <Search className="absolute left-3 top-1/2 transform -translate-y-1/2 h-4 w-4 text-muted-foreground" />
              <input
                type="text"
                placeholder={t("searchPlaceholder")}
                value={searchDraft}
                onChange={(e) => onSearchInput(e.target.value)}
                className="w-full pl-10 pr-4 py-2 border rounded-md focus:outline-none focus:ring-2 focus:ring-primary"
              />
            </div>

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

            {/* Filter Toggle */}
            <Button
              variant="outline"
              aria-expanded={showFilters}
              aria-controls={filtersPanelId}
              onClick={() => setShowFilters(!showFilters)}
              className="flex items-center gap-2"
            >
              <Filter className="h-4 w-4" />
              {t("filtersLabel")}
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

          {/* Advanced Filters: the wrapper always exists so the toggle's aria-controls resolves */}
          <div id={filtersPanelId}>
            {showFilters && (
              <PuzzleFilters
                filters={filters}
                onFiltersChange={(next) =>
                  onSearchChange((prev) => ({ ...prev, ...facetSearch(next) }))
                }
                className="mt-4"
              />
            )}
          </div>
        </CardContent>
      </Card>

      {/* View Mode Toggle */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <Button
            variant={viewMode === "grid" ? "default" : "outline"}
            size="sm"
            onClick={() =>
              onSearchChange((prev) => ({ ...prev, view: undefined }))
            }
          >
            <Grid className="h-4 w-4" />
          </Button>
          <Button
            variant={viewMode === "list" ? "default" : "outline"}
            size="sm"
            onClick={() =>
              onSearchChange((prev) => ({ ...prev, view: "list" }))
            }
          >
            <List className="h-4 w-4" />
          </Button>
        </div>
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
        <PuzzleViewProvider viewMode={viewMode}>
          {puzzles.map((puzzle) => (
            <PuzzleCard key={puzzle._id} puzzle={puzzle} />
          ))}
        </PuzzleViewProvider>
      ) : listState === "complete" ? (
        <Card>
          <CardContent className="p-12 text-center">
            <div className="text-muted-foreground">
              <div className="w-16 h-16 mx-auto mb-4 rounded-full bg-muted flex items-center justify-center">
                <Search className="h-8 w-8" />
              </div>
              <h3 className="text-lg font-medium mb-2">
                {t("noPuzzlesFound")}
              </h3>
              <p className="text-sm">{t("tryDifferentFilters")}</p>
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
