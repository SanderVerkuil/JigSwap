import { Link } from "@/compat/link";
import { usePageHeaderActions } from "@/components/dashboard-layout/page-header-slot";
import { EmptyState } from "@/components/library/empty-state";
import { PuzzleCard } from "@/components/puzzles/puzzle-card";
import { PuzzleViewProvider } from "@/components/puzzles/puzzle-view-provider";
import { GuideHelpButton } from "@/components/tour/guide-help-button";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { PageLoading } from "@/components/ui/loading";
import { useTourLauncher } from "@/components/whats-new/tour-launcher";
import { gateway } from "@/gateway";
import { catalogueSearchKey, detectBarcode } from "@/lib/catalogue-search";
import { pageTitle } from "@/lib/page-title";
import { convexQuery } from "@convex-dev/react-query";
import { useQuery } from "@tanstack/react-query";
import { createFileRoute } from "@tanstack/react-router";
// sanctioned convex/react exception: usePaginatedQuery (see tanstack-query migration spec)
import { usePaginatedQuery } from "convex/react";
import type { FunctionReturnType } from "convex/server";
import { ListPlus, Plus, ScanBarcode, Search } from "lucide-react";
import { useCallback, useEffect, useState } from "react";
import { useTranslations } from "use-intl";

export const Route = createFileRoute("/_dashboard/my-puzzles/add/")({
  head: ({ match }) => ({
    meta: [{ title: pageTitle(match.context, "addPuzzle") }],
  }),
  component: AddPuzzleChooserPage,
});

// The card renders the catalog summary shape (the same `catalog.search`
// paginates); the contributed list returns raw puzzle rows that carry the same
// display fields, so we narrow them to the card's prop type at the call site.
type CardPuzzle = FunctionReturnType<
  typeof gateway.catalog.recentPuzzles
>[number];

const SEARCH_DEBOUNCE_MS = 300;

function useDebouncedValue(value: string, delayMs: number): string {
  const [debounced, setDebounced] = useState(value);
  useEffect(() => {
    const handle = setTimeout(() => setDebounced(value), delayMs);
    return () => clearTimeout(handle);
  }, [value, delayMs]);
  return debounced;
}

function matchesSearch(
  puzzle: { title: string; brand?: string | null },
  term: string,
): boolean {
  if (!term) return true;
  const q = term.toLowerCase();
  return (
    puzzle.title.toLowerCase().includes(q) ||
    (!!puzzle.brand && puzzle.brand.toLowerCase().includes(q))
  );
}

function AddPuzzleChooserPage() {
  const t = useTranslations("puzzles");
  const tPicker = useTranslations("cataloguePicker");
  const [searchInput, setSearchInput] = useState("");
  // The server search runs on the debounced, normalised key; a barcode-shaped
  // key runs the EAN/UPC lookup instead of the text search.
  const searchKey = useDebouncedValue(
    catalogueSearchKey(searchInput),
    SEARCH_DEBOUNCE_MS,
  );
  const barcode = detectBarcode(searchKey);
  // A callback ref (state) so the observer re-attaches whenever the sentinel
  // remounts, e.g. when leaving the barcode view.
  const [sentinel, setSentinel] = useState<HTMLDivElement | null>(null);

  // The member's own not-yet-approved submissions — offered first so they can
  // acquire a copy of a puzzle they contributed before it is approved.
  const { data: mySubmissions } = useQuery(
    convexQuery(gateway.catalog.myContributedPuzzles, {}),
  );

  // The approved catalogue, searched server-side and paginated with infinite
  // scroll, so matches beyond the loaded page are still found.
  const {
    results: catalogue,
    status,
    loadMore,
  } = usePaginatedQuery(
    gateway.catalog.search,
    barcode ? "skip" : { searchTerm: searchKey || undefined },
    { initialNumItems: 20 },
  );

  const { data: barcodeMatch, isPending: barcodePending } = useQuery(
    convexQuery(
      gateway.catalog.lookupBarcode,
      barcode ? { code: barcode } : "skip",
    ),
  );

  const handleObserver = useCallback(
    (entries: IntersectionObserverEntry[]) => {
      const [target] = entries;
      if (target.isIntersecting && status === "CanLoadMore") {
        loadMore(20);
      }
    },
    [loadMore, status],
  );

  useEffect(() => {
    const element = sentinel;
    if (!element) return;
    const observer = new IntersectionObserver(handleObserver, {
      root: null,
      rootMargin: "20px",
      threshold: 0.1,
    });
    observer.observe(element);
    return () => observer.unobserve(element);
  }, [handleObserver, sentinel]);

  // Publish the primary "Create new" action into the shared shell page head;
  // the title/subtitle come from route-meta (shell.pages.addPuzzle).
  const { startTour } = useTourLauncher();
  usePageHeaderActions(
    () => (
      <>
        <GuideHelpButton tourId="add-puzzle" startTour={startTour} />
        <Button variant="outline" size="sm" asChild>
          <Link href="/my-puzzles/add/quick" data-tour="add-puzzle-several">
            <ListPlus className="h-4 w-4" />
            {tPicker("openPicker")}
          </Link>
        </Button>
        <Button variant="brand" size="sm" asChild>
          <Link href="/my-puzzles/add/new">
            <Plus className="h-4 w-4" />
            {t("chooser.createNew")}
          </Link>
        </Button>
      </>
    ),
    [startTour],
  );

  const filteredSubmissions = barcode
    ? []
    : (mySubmissions ?? []).filter((p) => matchesSearch(p, searchKey));

  const createNewCta = (
    <Button variant="outline" asChild>
      <Link href="/my-puzzles/add/new">
        <Plus className="h-4 w-4" />
        {t("chooser.createNew")}
      </Link>
    </Button>
  );

  // First paint: both reads still loading and nothing to show yet.
  if (
    mySubmissions === undefined &&
    !searchKey &&
    status === "LoadingFirstPage"
  ) {
    return <PageLoading message={t("loadingPuzzles")} />;
  }

  const spinner = (
    <div className="flex justify-center py-4">
      <div className="border-primary h-6 w-6 animate-spin rounded-full border-b-2" />
    </div>
  );

  const nothingToShow =
    status !== "LoadingFirstPage" &&
    filteredSubmissions.length === 0 &&
    catalogue.length === 0;

  return (
    <div className="flex flex-col gap-8">
      {/* Search */}
      <div className="relative w-full max-w-sm" data-tour="add-puzzle-search">
        <Search className="text-muted-foreground absolute top-1/2 left-3 h-4 w-4 -translate-y-1/2" />
        <Input
          type="text"
          placeholder={t("chooser.searchPlaceholder")}
          value={searchInput}
          onChange={(e) => setSearchInput(e.target.value)}
          className="pl-9"
        />
      </div>

      {/* Your submissions */}
      {filteredSubmissions.length > 0 && (
        <section className="flex flex-col gap-4">
          <div>
            <h2 className="font-heading text-lg font-bold">
              {t("chooser.yourSubmissions")}
            </h2>
            <p className="text-muted-foreground text-sm">
              {t("chooser.yourSubmissionsHint")}
            </p>
          </div>
          <PuzzleViewProvider viewMode="grid">
            {filteredSubmissions.map((puzzle) => (
              <PuzzleCard key={puzzle._id} puzzle={puzzle as CardPuzzle} />
            ))}
          </PuzzleViewProvider>
        </section>
      )}

      {/* Barcode lookup: replaces the text search for an EAN/UPC-shaped input. */}
      {barcode && (
        <section className="flex flex-col gap-4">
          <h2 className="font-heading flex items-center gap-2 text-lg font-bold">
            <ScanBarcode className="h-5 w-5" />
            {t("chooser.barcodeResult", { code: barcode })}
          </h2>
          {barcodePending ? (
            spinner
          ) : barcodeMatch ? (
            <PuzzleViewProvider viewMode="grid">
              <PuzzleCard puzzle={barcodeMatch} />
            </PuzzleViewProvider>
          ) : (
            <EmptyState
              title={t("chooser.barcodeNotFound", { code: barcode })}
              sub={t("chooser.barcodeNotFoundHint")}
              action={
                <Button variant="outline" asChild>
                  <Link
                    href={`/my-puzzles/add/new?${barcode.length === 12 ? "upc" : "ean"}=${barcode}`}
                  >
                    <Plus className="h-4 w-4" />
                    {t("chooser.registerIt")}
                  </Link>
                </Button>
              }
            />
          )}
        </section>
      )}

      {/* All puzzles */}
      {!barcode && (
        <section className="flex flex-col gap-4">
          <div>
            <h2 className="font-heading text-lg font-bold">
              {t("chooser.allPuzzles")}
            </h2>
            <p className="text-muted-foreground text-sm">
              {t("chooser.allPuzzlesHint")}
            </p>
          </div>

          {nothingToShow ? (
            <EmptyState
              title={t("chooser.noResults")}
              sub={t("chooser.cantFind")}
              action={createNewCta}
            />
          ) : (
            <>
              {status === "LoadingFirstPage" ? (
                spinner
              ) : catalogue.length > 0 ? (
                <PuzzleViewProvider viewMode="grid">
                  {catalogue.map((puzzle) => (
                    <PuzzleCard key={puzzle._id} puzzle={puzzle} />
                  ))}
                </PuzzleViewProvider>
              ) : (
                <p className="text-muted-foreground text-sm">
                  {t("chooser.noCatalogueResults")}
                </p>
              )}

              {/* Infinite scroll sentinel */}
              <div ref={setSentinel} className="h-4" />
              {status === "LoadingMore" && spinner}
            </>
          )}
        </section>
      )}

      {/* Persistent "can't find it?" CTA below the grid. */}
      <div className="flex flex-col items-center gap-2 border-t border-border pt-6 text-center">
        <p className="text-muted-foreground text-sm">{t("chooser.cantFind")}</p>
        {createNewCta}
      </div>
    </div>
  );
}
