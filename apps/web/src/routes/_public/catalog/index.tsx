import { Link } from "@/compat/link";
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
import { convexQuery } from "@convex-dev/react-query";
import { useQuery } from "@tanstack/react-query";
import { createFileRoute } from "@tanstack/react-router";
import type { FunctionReturnType } from "convex/server";
import { Search } from "lucide-react";
import * as React from "react";
import { useTranslations } from "use-intl";

type BrowseResult = FunctionReturnType<typeof gateway.catalog.publicBrowse>;

const PAGE_SIZE = 20;
// The default (unfiltered) first page — the loader prefetches EXACTLY these args so the
// initial render is SSR'd (same pattern as the home page's globalStatsQuery).
const defaultFirstPageQuery = convexQuery(gateway.catalog.publicBrowse, {
  paginationOpts: { numItems: PAGE_SIZE, cursor: null },
});

// Piece-count buckets from the spec: <500 / 500 / 1000 / 1500+.
const PIECE_BUCKETS = {
  lt500: { pieceMax: 499 },
  b500: { pieceMin: 500, pieceMax: 999 },
  b1000: { pieceMin: 1000, pieceMax: 1499 },
  b1500: { pieceMin: 1500 },
} as const;
type PieceBucket = keyof typeof PIECE_BUCKETS;

export const Route = createFileRoute("/_public/catalog/")({
  head: () => ({
    meta: [
      { title: "Puzzle catalogue — JigSwap" },
      {
        name: "description",
        content:
          "Browse the JigSwap community puzzle catalogue: ratings, reviews and swap availability for jigsaw puzzles.",
      },
      { property: "og:title", content: "Puzzle catalogue — JigSwap" },
      {
        property: "og:description",
        content:
          "Browse the JigSwap community puzzle catalogue: ratings, reviews and swap availability for jigsaw puzzles.",
      },
    ],
  }),
  loader: async ({ context }) => {
    await context.queryClient.ensureQueryData(defaultFirstPageQuery);
  },
  component: CatalogListPage,
});

function CatalogListPage() {
  const t = useTranslations("publicCatalog");
  const { convexClient } = Route.useRouteContext();

  // Toolbar state. `searchInput` is the raw keystrokes; `searchTerm` is the debounced value the
  // query actually uses.
  const [searchInput, setSearchInput] = React.useState("");
  const [searchTerm, setSearchTerm] = React.useState("");
  const [brand, setBrand] = React.useState<string | undefined>(undefined);
  const [bucket, setBucket] = React.useState<PieceBucket | undefined>(
    undefined,
  );

  React.useEffect(() => {
    const handle = setTimeout(() => setSearchTerm(searchInput.trim()), 300);
    return () => clearTimeout(handle);
  }, [searchInput]);

  const filterArgs = React.useMemo(
    () => ({
      ...(searchTerm.length >= 1 ? { searchTerm } : {}),
      ...(brand ? { brand } : {}),
      ...(bucket ? PIECE_BUCKETS[bucket] : {}),
    }),
    [searchTerm, brand, bucket],
  );

  // First page: a plain reactive query (SSR'd for the unfiltered default via the loader).
  const { data: firstPage } = useQuery(
    convexQuery(gateway.catalog.publicBrowse, {
      paginationOpts: { numItems: PAGE_SIZE, cursor: null },
      ...filterArgs,
    }),
  );

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

  const { data: brands } = useQuery(convexQuery(gateway.catalog.allBrands, {}));

  const lastPage = extraPages.at(-1) ?? firstPage;
  const cards = [
    ...(firstPage?.page ?? []),
    ...extraPages.flatMap((p) => p.page),
  ];

  const loadMore = async () => {
    if (!lastPage || lastPage.isDone) return;
    setLoadingMore(true);
    try {
      const next = await convexClient.query(gateway.catalog.publicBrowse, {
        paginationOpts: {
          numItems: PAGE_SIZE,
          cursor: lastPage.continueCursor,
        },
        ...filterArgs,
      });
      setExtraPages((pages) => [...pages, next]);
    } finally {
      setLoadingMore(false);
    }
  };

  const clearSearch = () => {
    setSearchInput("");
    setSearchTerm("");
  };

  return (
    <main className="mx-auto w-full max-w-[1200px] px-6 py-10">
      <h1 className="font-heading text-3xl font-bold tracking-tight">
        {t("title")}
      </h1>
      <p className="text-muted-foreground mt-1">{t("subtitle")}</p>

      {/* Toolbar: search + brand + piece bucket. One row on >=sm, stacked on mobile. */}
      <div className="mt-6 flex flex-col gap-2.5 sm:flex-row sm:items-center">
        <div className="relative flex-1">
          <Search className="text-muted-foreground absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2" />
          <Input
            value={searchInput}
            onChange={(e) => setSearchInput(e.target.value)}
            placeholder={t("searchPlaceholder")}
            className="pl-9"
          />
        </div>
        <Select
          value={brand ?? "all"}
          onValueChange={(v) => setBrand(v === "all" ? undefined : v)}
        >
          <SelectTrigger className="w-full sm:w-44">
            <SelectValue placeholder={t("allBrands")} />
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
          value={bucket ?? "all"}
          onValueChange={(v) =>
            setBucket(v === "all" ? undefined : (v as PieceBucket))
          }
        >
          <SelectTrigger className="w-full sm:w-48">
            <SelectValue placeholder={t("allPieces")} />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">{t("allPieces")}</SelectItem>
            <SelectItem value="lt500">{t("piecesLt500")}</SelectItem>
            <SelectItem value="b500">{t("pieces500")}</SelectItem>
            <SelectItem value="b1000">{t("pieces1000")}</SelectItem>
            <SelectItem value="b1500">{t("pieces1500")}</SelectItem>
          </SelectContent>
        </Select>
      </div>

      {/* Grid */}
      <div className="mt-8">
        {firstPage === undefined ? (
          <div className="grid grid-cols-2 gap-[18px] md:grid-cols-3 lg:grid-cols-4">
            {Array.from({ length: 8 }).map((_, i) => (
              <Skeleton key={i} className="aspect-[3/4] w-full rounded-xl" />
            ))}
          </div>
        ) : cards.length === 0 ? (
          searchTerm ? (
            <EmptyState
              title={t("noResults", { query: searchTerm })}
              sub={t("noResultsSub")}
              action={
                <Button variant="ghost" onClick={clearSearch}>
                  {t("clearSearch")}
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
              {cards.map((card) => (
                <DefinitionCard key={card._id} card={card} />
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

      {/* Conversion tail for logged-out visitors (members get redirected off /catalog/$id anyway,
          and this static CTA is harmless if they browse the list). */}
      <div className="mt-12 flex justify-center">
        <Button variant="brand" asChild>
          <Link href="/sign-up">{t("joinCta")}</Link>
        </Button>
      </div>
    </main>
  );
}
