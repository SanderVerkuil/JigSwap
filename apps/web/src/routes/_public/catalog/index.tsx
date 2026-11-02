import { Link } from "@/compat/link";
import { MAIN_CONTENT_ID } from "@/components/a11y/skip-link";
import { EmptyState } from "@/components/library/empty-state";
import { DefinitionCard } from "@/components/puzzles/definition-card";
import { PuzzleViewProvider } from "@/components/puzzles/puzzle-view-provider";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Skeleton } from "@/components/ui/skeleton";
import { gateway } from "@/gateway";
import {
  isPieceBucket,
  normalizeCatalogQuery,
  publicCatalogFilterArgs,
  validatePublicCatalogSearch,
  type PieceBucket,
  type PublicCatalogSearch,
} from "@/lib/public-catalog-search";
import { seoHead } from "@/lib/seo-head";
import { convexQuery } from "@convex-dev/react-query";
import { useQuery } from "@tanstack/react-query";
import { createFileRoute, useNavigate } from "@tanstack/react-router";
// sanctioned convex/react exception: Authenticated/Unauthenticated auth-state components (see tanstack-query migration spec)
import { Unauthenticated } from "convex/react";
import type { FunctionReturnType } from "convex/server";
import { Search } from "lucide-react";
import * as React from "react";
import { useTranslations } from "use-intl";

type BrowseResult = FunctionReturnType<typeof gateway.catalog.publicBrowse>;

const PAGE_SIZE = 20;
// The grid's first row at its widest (lg:grid-cols-4), which holds the page's
// likely LCP image: these covers are server-rendered eager and high priority,
// so the browser fetches them before the scripts run. On narrower grids this
// also covers (part of) the second row; covers further down stay lazy.
const ABOVE_THE_FOLD_CARDS = 4;
// The first page for the URL's filters. The loader prefetches EXACTLY these args so a
// filtered link renders its results on the server (same pattern as the home page's
// globalStatsQuery).
const firstPageQuery = (search: PublicCatalogSearch) =>
  convexQuery(gateway.catalog.publicBrowse, {
    paginationOpts: { numItems: PAGE_SIZE, cursor: null },
    ...publicCatalogFilterArgs(search),
  });

// How long typing pauses before the search term is written to the URL.
const SEARCH_DEBOUNCE_MS = 300;

const PIECE_BUCKET_LABELS = {
  lt500: "piecesLt500",
  b500: "pieces500",
  b1000: "pieces1000",
  b1500: "pieces1500",
} as const satisfies Record<PieceBucket, string>;

// A card cover's rendered width in the grid below (2/3/4 columns at base/md/lg, 18px gaps, inside
// the 1200px main with 24px padding, minus the card's 1px borders), so the browser fetches the
// smallest box-art rendition that is still sharp. Keep it in step with the grid's classes.
const CARD_IMAGE_SIZES =
  "(min-width: 1200px) 273px, (min-width: 1024px) calc((100vw - 110px) / 4), (min-width: 768px) calc((100vw - 90px) / 3), calc((100vw - 70px) / 2)";

export const Route = createFileRoute("/_public/catalog/")({
  // Search, brand and piece bucket live in the URL so Back from a puzzle restores them
  // and a filtered view can be shared.
  validateSearch: validatePublicCatalogSearch,
  loaderDeps: ({ search: { q, brand, pieces } }) => ({ q, brand, pieces }),
  head: ({ match }) => seoHead(match, "catalog"),
  loader: async ({ context, deps, cause }) => {
    // A filter change on the open page ("stay") doesn't wait for results: the controls
    // update at once and the grid shows its skeleton. Arriving at the page (SSR, a shared
    // link, Back from a puzzle) waits, so the first render already has the results.
    if (cause === "stay") return;
    await context.queryClient.ensureQueryData(firstPageQuery(deps));
  },
  component: CatalogListPage,
});

function CatalogListPage() {
  const t = useTranslations("publicCatalog");
  const { convexClient } = Route.useRouteContext();
  // The URL is the source of truth for the filters the results use.
  const { q, brand, pieces } = Route.useSearch();
  const navigate = useNavigate({ from: Route.fullPath });

  // Filter changes replace the history entry (Back leaves the catalogue rather than
  // stepping through every filter) and keep the scroll position.
  const updateSearch = React.useCallback(
    (patch: PublicCatalogSearch) => {
      void navigate({
        search: (prev) => ({ ...prev, ...patch }),
        replace: true,
        resetScroll: false,
      });
    },
    [navigate],
  );

  // The search box shows the raw keystrokes; `q` follows them into the URL once typing
  // pauses. `sentQ` is the term the box last wrote to (or took from) the URL and `seenQ`
  // the URL term at the last render. When the URL term changes to something the box did
  // not write (Back/Forward, a "Catalogue" link), the box takes it over. The echo of the
  // box's own write leaves it alone, even if more was typed while the URL caught up.
  const [searchInput, setSearchInput] = React.useState(q ?? "");
  const [sentQ, setSentQ] = React.useState(q);
  const [seenQ, setSeenQ] = React.useState(q);
  if (q !== seenQ) {
    setSeenQ(q);
    if (q !== sentQ) {
      setSentQ(q);
      setSearchInput(q ?? "");
    }
  }

  React.useEffect(() => {
    const next = normalizeCatalogQuery(searchInput);
    if (next === sentQ) return;
    const handle = setTimeout(() => {
      setSentQ(next);
      updateSearch({ q: next });
    }, SEARCH_DEBOUNCE_MS);
    return () => clearTimeout(handle);
  }, [searchInput, sentQ, updateSearch]);

  const filterArgs = React.useMemo(
    () => publicCatalogFilterArgs({ q, brand, pieces }),
    [q, brand, pieces],
  );

  // First page: a plain reactive query, prefetched by the loader for the URL's filters.
  const { data: firstPage } = useQuery(firstPageQuery({ q, brand, pieces }));

  // Older pages accumulate in local state; a filter change resets them. We reset during render
  // (the sanctioned "adjust state when a value changes" pattern) rather than in an effect, which
  // would trip the react-hooks/set-state-in-effect rule.
  const [extraPages, setExtraPages] = React.useState<BrowseResult[]>([]);
  const [loadingMore, setLoadingMore] = React.useState(false);
  const filterKey = JSON.stringify(filterArgs);
  const [prevFilterKey, setPrevFilterKey] = React.useState(filterKey);
  if (filterKey !== prevFilterKey) {
    setPrevFilterKey(filterKey);
    setExtraPages([]);
  }
  // Mirror the current filterKey into a ref so an in-flight loadMore can read the LATEST value
  // after its await (the handler's closed-over `filterKey` is stale by then).
  const filterKeyRef = React.useRef(filterKey);
  React.useEffect(() => {
    filterKeyRef.current = filterKey;
  }, [filterKey]);

  const { data: brands } = useQuery(convexQuery(gateway.catalog.allBrands, {}));

  const lastPage = extraPages.at(-1) ?? firstPage;
  const cards = [
    ...(firstPage?.page ?? []),
    ...extraPages.flatMap((p) => p.page),
  ];

  const loadMore = async () => {
    if (!lastPage || lastPage.isDone) return;
    // Capture the filter this page is being fetched under. If the filter changes mid-flight, the
    // awaited page (and its continueCursor) belong to the OLD filter — drop it rather than append a
    // foreign page onto the reset list.
    const requestedFilterKey = filterKey;
    setLoadingMore(true);
    try {
      const next = await convexClient.query(gateway.catalog.publicBrowse, {
        paginationOpts: {
          numItems: PAGE_SIZE,
          cursor: lastPage.continueCursor,
        },
        ...filterArgs,
      });
      if (requestedFilterKey !== filterKeyRef.current) return;
      setExtraPages((pages) => [...pages, next]);
    } finally {
      setLoadingMore(false);
    }
  };

  const clearFilters = () => {
    setSearchInput("");
    setSentQ(undefined);
    updateSearch({ q: undefined, brand: undefined, pieces: undefined });
  };

  return (
    <main
      id={MAIN_CONTENT_ID}
      className="mx-auto w-full max-w-[1200px] px-6 py-10"
    >
      <h1 className="font-heading text-3xl font-bold tracking-tight">
        {t("title")}
      </h1>
      <p className="text-muted-foreground mt-1">{t("subtitle")}</p>

      {/* Toolbar: search + brand + piece bucket. One row on >=sm; on phones the search gets
          its own row and the two selects share the next, so results start sooner. The piece
          column is wider because its labels are. The triggers render their label themselves:
          it shows in the server HTML for a filtered link, and a long one ends in an ellipsis
          instead of being clipped. */}
      <div className="mt-6 flex flex-col gap-2.5 sm:flex-row sm:items-center">
        <div className="relative flex-1">
          <Search className="text-muted-foreground absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2" />
          <Input
            type="search"
            aria-label={t("searchLabel")}
            value={searchInput}
            onChange={(e) => setSearchInput(e.target.value)}
            placeholder={t("searchPlaceholder")}
            className="pl-9"
          />
        </div>
        <div className="grid grid-cols-[minmax(0,4fr)_minmax(0,5fr)] gap-2.5 sm:flex">
          <Select
            value={brand ?? "all"}
            onValueChange={(v) =>
              updateSearch({ brand: v === "all" ? undefined : v })
            }
          >
            <SelectTrigger
              aria-label={t("brandLabel")}
              className="w-full sm:w-44"
            >
              <SelectValue>
                <span className="truncate">{brand ?? t("allBrands")}</span>
              </SelectValue>
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">{t("allBrands")}</SelectItem>
              {(brands ?? [])
                .filter((b): b is string => !!b)
                .map((b) => (
                  <SelectItem key={b} value={b}>
                    {b}
                  </SelectItem>
                ))}
            </SelectContent>
          </Select>
          <Select
            value={pieces ?? "all"}
            onValueChange={(v) =>
              updateSearch({ pieces: isPieceBucket(v) ? v : undefined })
            }
          >
            <SelectTrigger
              aria-label={t("piecesLabel")}
              className="w-full sm:w-56"
            >
              <SelectValue>
                <span className="truncate">
                  {pieces ? t(PIECE_BUCKET_LABELS[pieces]) : t("allPieces")}
                </span>
              </SelectValue>
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">{t("allPieces")}</SelectItem>
              {(
                Object.entries(PIECE_BUCKET_LABELS) as [PieceBucket, string][]
              ).map(([bucket, label]) => (
                <SelectItem key={bucket} value={bucket}>
                  {t(label)}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
      </div>

      {/* Grid. The sr-only h2 keeps the heading outline h1 > h2 > card h3. */}
      <div className="mt-8">
        <h2 className="sr-only">{t("resultsHeading")}</h2>
        {firstPage === undefined ? (
          <div className="grid grid-cols-2 gap-[18px] md:grid-cols-3 lg:grid-cols-4">
            {Array.from({ length: 8 }).map((_, i) => (
              <Skeleton key={i} className="aspect-[3/4] w-full rounded-xl" />
            ))}
          </div>
        ) : cards.length === 0 && lastPage?.isDone ? (
          q || brand || pieces ? (
            <EmptyState
              title={q ? t("noResults", { query: q }) : t("noResultsFiltered")}
              sub={t(q ? "noResultsSub" : "noResultsFilteredSub")}
              action={
                <Button variant="outline" onClick={clearFilters}>
                  {t(brand || pieces ? "clearFilters" : "clearSearch")}
                </Button>
              }
            />
          ) : (
            <EmptyState title={t("empty")} sub={t("emptySub")} />
          )
        ) : (
          <>
            <PuzzleViewProvider
              viewMode="grid"
              className="grid grid-cols-2 gap-[18px] md:grid-cols-3 lg:grid-cols-4"
            >
              {cards.map((card, index) => (
                <DefinitionCard
                  key={card._id}
                  card={card}
                  imageSizes={CARD_IMAGE_SIZES}
                  priority={index < ABOVE_THE_FOLD_CARDS}
                />
              ))}
            </PuzzleViewProvider>
            {lastPage && !lastPage.isDone && (
              <div className="mt-8 flex justify-center">
                <Button
                  variant="outline"
                  onClick={() => void loadMore()}
                  disabled={loadingMore}
                >
                  {t("loadMore")}
                </Button>
              </div>
            )}
          </>
        )}
      </div>

      {/* Conversion tail for logged-out visitors. */}
      <Unauthenticated>
        <div className="mt-12 flex justify-center">
          <Button variant="brand" asChild>
            <Link href="/sign-up">{t("joinCta")}</Link>
          </Button>
        </div>
      </Unauthenticated>
    </main>
  );
}
