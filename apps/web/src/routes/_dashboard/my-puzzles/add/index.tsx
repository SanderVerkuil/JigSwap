import { pageTitle } from "@/lib/page-title";
import { createFileRoute } from "@tanstack/react-router";

import { Link } from "@/compat/link";
import { usePageHeaderActions } from "@/components/dashboard-layout/page-header-slot";
import { EmptyState } from "@/components/library/empty-state";
import { PuzzleCard } from "@/components/puzzles/puzzle-card";
import { PuzzleViewProvider } from "@/components/puzzles/puzzle-view-provider";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { PageLoading } from "@/components/ui/loading";
import { gateway } from "@/gateway";
import { convexQuery } from "@convex-dev/react-query";
import { useQuery } from "@tanstack/react-query";
// sanctioned convex/react exception: usePaginatedQuery (see tanstack-query migration spec)
import { usePaginatedQuery } from "convex/react";
import type { FunctionReturnType } from "convex/server";
import { Plus, Search } from "lucide-react";
import { useCallback, useEffect, useRef, useState } from "react";
import { useTranslations } from "use-intl";

export const Route = createFileRoute("/_dashboard/my-puzzles/add/")({
  head: ({ match }) => ({
    meta: [{ title: pageTitle(match.context, "addPuzzle") }],
  }),
  component: AddPuzzleChooserPage,
});

// The card renders the catalog summary shape (the same `catalog.listAll`
// paginates); the contributed list returns raw puzzle rows that carry the same
// display fields, so we narrow them to the card's prop type at the call site.
type CardPuzzle = FunctionReturnType<
  typeof gateway.catalog.recentPuzzles
>[number];

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
  const [searchTerm, setSearchTerm] = useState("");
  const observerRef = useRef<HTMLDivElement>(null);

  // The member's own not-yet-approved submissions — offered first so they can
  // acquire a copy of a puzzle they contributed before it is approved.
  const { data: mySubmissions } = useQuery(
    convexQuery(gateway.catalog.myContributedPuzzles, {}),
  );

  // The full, paginated, approved catalogue with infinite scroll (mirrors
  // puzzle-client.tsx).
  const {
    results: catalogue,
    status,
    loadMore,
  } = usePaginatedQuery(gateway.catalog.listAll, {}, { initialNumItems: 20 });

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

  // Publish the primary "Create new" action into the shared shell page head;
  // the title/subtitle come from route-meta (shell.pages.addPuzzle).
  usePageHeaderActions(
    () => (
      <Button variant="brand" size="sm" asChild>
        <Link href="/my-puzzles/add/new">
          <Plus className="h-4 w-4" />
          {t("chooser.createNew")}
        </Link>
      </Button>
    ),
    [],
  );

  const filteredSubmissions = (mySubmissions ?? []).filter((p) =>
    matchesSearch(p, searchTerm),
  );
  const filteredCatalogue = catalogue.filter((p) =>
    matchesSearch(p, searchTerm),
  );

  const createNewCta = (
    <Button variant="outline" asChild>
      <Link href="/my-puzzles/add/new">
        <Plus className="h-4 w-4" />
        {t("chooser.createNew")}
      </Link>
    </Button>
  );

  // First paint: both reads still loading and nothing to show yet.
  if (mySubmissions === undefined && catalogue.length === 0) {
    return <PageLoading message={t("loadingPuzzles")} />;
  }

  const nothingToShow =
    filteredSubmissions.length === 0 && filteredCatalogue.length === 0;

  return (
    <div className="flex flex-col gap-8">
      {/* Search */}
      <div className="relative w-full max-w-sm">
        <Search className="text-muted-foreground absolute top-1/2 left-3 h-4 w-4 -translate-y-1/2" />
        <Input
          type="text"
          placeholder={t("chooser.searchPlaceholder")}
          value={searchTerm}
          onChange={(e) => setSearchTerm(e.target.value)}
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

      {/* All puzzles */}
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
            {filteredCatalogue.length > 0 ? (
              <PuzzleViewProvider viewMode="grid">
                {filteredCatalogue.map((puzzle) => (
                  <PuzzleCard key={puzzle._id} puzzle={puzzle} />
                ))}
              </PuzzleViewProvider>
            ) : (
              <p className="text-muted-foreground text-sm">
                {t("chooser.noCatalogueResults")}
              </p>
            )}

            {/* Infinite scroll sentinel */}
            <div ref={observerRef} className="h-4" />
            {status === "LoadingMore" && (
              <div className="flex justify-center py-4">
                <div className="border-primary h-6 w-6 animate-spin rounded-full border-b-2" />
              </div>
            )}
          </>
        )}
      </section>

      {/* Persistent "can't find it?" CTA below the grid. */}
      <div className="flex flex-col items-center gap-2 border-t border-border pt-6 text-center">
        <p className="text-muted-foreground text-sm">{t("chooser.cantFind")}</p>
        {createNewCta}
      </div>
    </div>
  );
}
