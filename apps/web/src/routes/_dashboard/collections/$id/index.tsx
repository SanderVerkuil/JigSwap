import { pageTitle } from "@/lib/page-title";
import { createFileRoute } from "@tanstack/react-router";

import { Link } from "@/compat/link";
import { useRouter } from "@/compat/navigation";
import { usePageHeader } from "@/components/dashboard-layout/page-header-slot";
import { EmptyState } from "@/components/library/empty-state";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { PageLoading } from "@/components/ui/loading";
import { PuzzleCard, PuzzleViewProvider } from "@/components/ui/puzzle-card";
import { gateway, Id } from "@/gateway";
import { useMutation, useQuery } from "convex/react";
import { Edit, Grid, List, Plus, Search } from "lucide-react";
import { useState } from "react";
import { useTranslations } from "use-intl";

export const Route = createFileRoute("/_dashboard/collections/$id/")({
  head: ({ match }) => ({
    meta: [{ title: pageTitle(match.context, "collection") }],
  }),
  pendingComponent: () => <CollectionPending />,
  component: CollectionDetailPage,
});

function CollectionPending() {
  const tCommon = useTranslations("common");
  return <PageLoading message={tCommon("loading")} />;
}

function CollectionDetailPage() {
  const { id } = Route.useParams();
  const router = useRouter();
  const t = useTranslations("collections");
  const tCommon = useTranslations("common");
  const tPuzzles = useTranslations("puzzles");
  const [viewMode, setViewMode] = useState<"grid" | "list">("grid");
  const [searchTerm, setSearchTerm] = useState("");

  const collection = useQuery(gateway.collections.byId, {
    collectionId: id as Id<"collections">,
  });

  const removeFromCollection = useMutation(
    gateway.collections.removeOwnedPuzzle,
  );

  const handleRemovePuzzle = async (ownedPuzzleId: Id<"ownedPuzzles">) => {
    // The domain remove takes the Collection + Copy aggregateIds; resolve them from the loaded
    // collection and its member rows, and guard rows that predate the backfill.
    const copy = collection?.puzzles?.find((p) => p && p._id === ownedPuzzleId);
    if (!collection?.aggregateId || !copy?.aggregateId) {
      console.error(
        "Cannot remove: collection or copy is missing aggregateId.",
      );
      return;
    }
    try {
      await removeFromCollection({
        collectionId: collection.aggregateId,
        copyId: copy.aggregateId,
      });
    } catch (error) {
      console.error("Failed to remove puzzle from collection:", error);
    }
  };

  // Publish the collection name as the page-head title (so the breadcrumb reads
  // My Library › Collections › <name>) plus the count, Edit and Add actions.
  const totalPuzzles = (collection?.puzzles ?? []).filter(Boolean).length;
  usePageHeader(
    () => ({
      title: collection
        ? collection.icon
          ? `${collection.icon} ${collection.name}`
          : collection.name
        : undefined,
      actions: collection ? (
        <>
          <span className="text-muted-foreground hidden text-sm sm:inline">
            {t("puzzleCount", { count: totalPuzzles })}
          </span>
          <Button
            variant="outline"
            size="sm"
            onClick={() => router.push(`/collections/${id}/edit`)}
          >
            <Edit className="h-4 w-4" />
            {tCommon("edit")}
          </Button>
          <Button variant="brand" size="sm" asChild>
            <Link href={`/collections/${id}/add-puzzles`}>
              <Plus className="h-4 w-4" />
              {t("addPuzzles")}
            </Link>
          </Button>
        </>
      ) : null,
    }),
    [collection?.name, collection?.icon, totalPuzzles, id],
  );

  if (collection === undefined) {
    return <PageLoading message={tCommon("loading")} />;
  }

  if (collection === null) {
    return <div className="text-muted-foreground">{t("notFound")}</div>;
  }

  const filteredPuzzles = (collection.puzzles ?? [])
    .filter(Boolean)
    .filter((ownedPuzzle) => {
      const term = searchTerm.trim().toLowerCase();
      if (!term) return true;
      const title = ownedPuzzle.puzzle?.title?.toLowerCase() ?? "";
      const brand = ownedPuzzle.puzzle?.brand?.toLowerCase() ?? "";
      return title.includes(term) || brand.includes(term);
    });

  return (
    <div className="flex w-full flex-col gap-6">
      {collection.description && (
        <p className="text-muted-foreground max-w-3xl text-sm">
          {collection.description}
        </p>
      )}

      {totalPuzzles > 0 && (
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="relative w-full max-w-sm">
            <Search className="text-muted-foreground absolute top-1/2 left-3 h-4 w-4 -translate-y-1/2" />
            <Input
              type="text"
              placeholder={tCommon("search")}
              value={searchTerm}
              onChange={(e) => setSearchTerm(e.target.value)}
              className="pl-9"
            />
          </div>
          <div className="flex items-center gap-2">
            <Button
              variant={viewMode === "grid" ? "secondary" : "ghost"}
              size="icon"
              aria-label={tPuzzles("gridView")}
              onClick={() => setViewMode("grid")}
            >
              <Grid className="h-4 w-4" />
            </Button>
            <Button
              variant={viewMode === "list" ? "secondary" : "ghost"}
              size="icon"
              aria-label={tPuzzles("listView")}
              onClick={() => setViewMode("list")}
            >
              <List className="h-4 w-4" />
            </Button>
          </div>
        </div>
      )}

      {totalPuzzles === 0 ? (
        <EmptyState
          title={t("noPuzzlesInCollection")}
          sub={t("addPuzzlesToCollection")}
          action={
            <Button variant="brand" asChild>
              <Link href={`/collections/${id}/add-puzzles`}>
                <Plus className="h-4 w-4" />
                {t("addPuzzles")}
              </Link>
            </Button>
          }
        />
      ) : (
        <PuzzleViewProvider viewMode={viewMode}>
          {filteredPuzzles.map((puzzle) => (
            <PuzzleCard
              key={puzzle._id}
              puzzle={puzzle}
              variant="collection"
              onRemove={handleRemovePuzzle}
            />
          ))}
        </PuzzleViewProvider>
      )}
    </div>
  );
}
