import { pageTitle } from "@/lib/page-title";
import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { toast } from "sonner";

import { useUser } from "@/compat/clerk";
import { EmptyState, FilterBar } from "@/components/community/primitives";
import { Button } from "@/components/ui/button";
import { PageLoading } from "@/components/ui/loading";
import { PuzzleCard, PuzzleViewProvider } from "@/components/ui/puzzle-card";
import { gateway, Id } from "@/gateway";
import { useQuery } from "convex/react";
import { Grid, List } from "lucide-react";
import { useState } from "react";
import { useTranslations } from "use-intl";

export const Route = createFileRoute("/_dashboard/browse")({
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

type Difficulty = "easy" | "medium" | "hard" | "expert";
type Condition = "new_sealed" | "like_new" | "good" | "fair" | "poor";

// The primary pill row: All, Available (any availability flag set on the
// copy), or one of the real difficulty tiers the browse query filters on.
type BrowsePill = "all" | "available" | Difficulty;

const DIFFICULTIES: Difficulty[] = ["easy", "medium", "hard", "expert"];
const CONDITIONS: Condition[] = [
  "new_sealed",
  "like_new",
  "good",
  "fair",
  "poor",
];

function BrowsePage() {
  const navigate = useNavigate();
  const { user } = useUser();
  const t = useTranslations("puzzles");
  const tCommon = useTranslations("common");
  const tBrowse = useTranslations("browse");

  const [viewMode, setViewMode] = useState<"grid" | "list">("grid");
  const [pill, setPill] = useState<BrowsePill>("all");
  const [selectedCategory, setSelectedCategory] = useState("");
  const [selectedCondition, setSelectedCondition] = useState("");
  const [minPieces, setMinPieces] = useState("");
  const [maxPieces, setMaxPieces] = useState("");

  const convexUser = useQuery(
    gateway.identity.byClerkId,
    user?.id ? { clerkId: user.id } : "skip",
  );

  // Difficulty pills map onto the server-side difficulty filter; the
  // "Available" pill filters client-side on the copy's availability flags.
  const pillDifficulty = DIFFICULTIES.includes(pill as Difficulty)
    ? (pill as Difficulty)
    : undefined;

  // Free-text catalog search lives in the global ⌘K command palette
  // (gateway.search.global), so Browse owns exploration via facets only.
  const browseOwnedPuzzlesResult = useQuery(gateway.library.browseOwned, {
    category: selectedCategory
      ? (selectedCategory as Id<"adminCategories">)
      : undefined,
    difficulty: pillDifficulty,
    condition: (selectedCondition as Condition) || undefined,
    minPieceCount: minPieces ? parseInt(minPieces) : undefined,
    maxPieceCount: maxPieces ? parseInt(maxPieces) : undefined,
    includeOwnPuzzles: false,
    limit: 50,
  });

  const categories = useQuery(gateway.catalog.puzzleCategories);

  const ownedPuzzles = browseOwnedPuzzlesResult?.ownedPuzzles || [];
  const shownPuzzles =
    pill === "available"
      ? ownedPuzzles.filter(
          (puzzle) =>
            puzzle.availability.forTrade ||
            puzzle.availability.forSale ||
            puzzle.availability.forLend,
        )
      : ownedPuzzles;

  const clearFilters = () => {
    setPill("all");
    setSelectedCategory("");
    setSelectedCondition("");
    setMinPieces("");
    setMaxPieces("");
  };

  const hasActiveFilters =
    pill !== "all" ||
    selectedCategory ||
    selectedCondition ||
    minPieces ||
    maxPieces;

  if (
    !user ||
    convexUser === undefined ||
    browseOwnedPuzzlesResult === undefined
  ) {
    return <PageLoading message={tCommon("loading")} />;
  }

  const pillFilters: Array<{ value: BrowsePill; label: string }> = [
    { value: "all", label: tBrowse("filterAll") },
    { value: "available", label: tBrowse("available") },
    ...DIFFICULTIES.map((difficulty) => ({
      value: difficulty as BrowsePill,
      label: t(difficulty),
    })),
  ];

  const selectClassName =
    "bg-card h-9 rounded-md border px-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-primary";

  return (
    <div className="flex flex-col gap-[18px]">
      {/* Filter pills + muted result count + ⌘K hint + view toggle. Free-text
          catalog search lives in the global command palette, so Browse leads
          with exploration (facets) and points to ⌘K for known-item lookup. */}
      <FilterBar
        filters={pillFilters}
        value={pill}
        onChange={setPill}
        count={tBrowse("resultsCount", { count: shownPuzzles.length })}
        extra={
          <div className="flex items-center gap-3">
            <span className="text-muted-foreground hidden text-sm sm:inline">
              {tBrowse("searchHint")}
            </span>
            <div className="flex items-center gap-1">
              <Button
                variant={viewMode === "grid" ? "secondary" : "ghost"}
                size="sm"
                onClick={() => setViewMode("grid")}
                aria-label="Grid"
              >
                <Grid className="h-4 w-4" />
              </Button>
              <Button
                variant={viewMode === "list" ? "secondary" : "ghost"}
                size="sm"
                onClick={() => setViewMode("list")}
                aria-label="List"
              >
                <List className="h-4 w-4" />
              </Button>
            </div>
          </div>
        }
      />

      {/* Secondary filters: category / condition / piece range, open on the
          ground instead of boxed in a card. */}
      <div className="flex flex-wrap items-center gap-2.5">
        <select
          value={selectedCategory}
          onChange={(e) => setSelectedCategory(e.target.value)}
          className={selectClassName}
          aria-label={t("category")}
        >
          <option value="">{tBrowse("allCategories")}</option>
          {categories?.map((category) => (
            <option key={category._id} value={category._id}>
              {category.name.en}
            </option>
          ))}
        </select>

        <select
          value={selectedCondition}
          onChange={(e) => setSelectedCondition(e.target.value)}
          className={selectClassName}
          aria-label={t("condition")}
        >
          <option value="">{tBrowse("allConditions")}</option>
          {CONDITIONS.map((condition) => (
            <option key={condition} value={condition}>
              {t(condition)}
            </option>
          ))}
        </select>

        <input
          type="number"
          placeholder={tBrowse("minPieces")}
          value={minPieces}
          onChange={(e) => setMinPieces(e.target.value)}
          className={`${selectClassName} w-28`}
          aria-label={tBrowse("minPieces")}
        />
        <input
          type="number"
          placeholder={tBrowse("maxPieces")}
          value={maxPieces}
          onChange={(e) => setMaxPieces(e.target.value)}
          className={`${selectClassName} w-28`}
          aria-label={tBrowse("maxPieces")}
        />

        {hasActiveFilters && (
          <Button variant="ghost" size="sm" onClick={clearFilters}>
            {tBrowse("clearFilters")}
          </Button>
        )}
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
          {shownPuzzles.map((puzzle) => (
            <PuzzleCard
              key={puzzle._id}
              puzzle={puzzle}
              variant="browse"
              showOwner={true}
              onRequestExchange={() => navigate({ to: "/trades" })}
              onMessage={() => navigate({ to: "/messages" })}
              onFavorite={() => toast(tBrowse("favoritesComingSoon"))}
            />
          ))}
        </PuzzleViewProvider>
      )}
    </div>
  );
}
