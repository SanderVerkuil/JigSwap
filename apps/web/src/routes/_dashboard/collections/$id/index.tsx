import { createFileRoute } from "@tanstack/react-router";

import { Link } from "@/compat/link";
import { useRouter } from "@/compat/navigation";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { PageLoading } from "@/components/ui/loading";
import { PuzzleCard, PuzzleViewProvider } from "@/components/ui/puzzle-card";
import { gateway, Id } from "@/gateway";
import { useMutation, useQuery } from "convex/react";
import { Edit, Grid, List, Plus, Search } from "lucide-react";
import { useState } from "react";
import { useTranslations } from "use-intl";

export const Route = createFileRoute("/_dashboard/collections/$id/")({
  pendingComponent: () => <PageLoading message="Loading..." />,
  component: CollectionDetailPage,
});

function CollectionDetailPage() {
  const { id } = Route.useParams();
  const router = useRouter();
  const t = useTranslations("collections");
  const tCommon = useTranslations("common");
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

  const handleEditCollection = () => {
    router.push(`/collections/${id}/edit`);
  };

  // Filter puzzles based on search term
  const filteredPuzzles =
    collection?.puzzles
      ?.filter(
        (ownedPuzzle) =>
          ownedPuzzle &&
          (ownedPuzzle.puzzle?.title
            .toLowerCase()
            .includes(searchTerm.toLowerCase()) ||
            (ownedPuzzle.puzzle?.brand &&
              ownedPuzzle.puzzle.brand
                .toLowerCase()
                .includes(searchTerm.toLowerCase()))),
      )
      .filter(Boolean) || [];

  if (collection === undefined) {
    return <PageLoading message={tCommon("loading")} />;
  }

  if (collection === null) {
    return <div>{t("notFound")}</div>;
  }

  return (
    <div className="container mx-auto space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-4">
          <div
            className="w-16 h-16 rounded-lg flex items-center justify-center text-2xl"
            style={{
              backgroundColor: collection.color || "#f3f4f6",
            }}
          >
            {collection.icon || "📦"}
          </div>
          <div>
            <h1 className="text-3xl font-bold">{collection.name}</h1>
            <p className="text-muted-foreground">
              {filteredPuzzles.length} {t("puzzles")}
            </p>
          </div>
        </div>
        <div className="flex items-center gap-2">
          <Button variant="outline" onClick={handleEditCollection}>
            <Edit className="h-4 w-4 mr-2" />
            {tCommon("edit")}
          </Button>
          <Button asChild>
            <Link href={`/collections/${id}/add-puzzles`}>
              <Plus className="h-4 w-4 mr-2" />
              {t("addPuzzles")}
            </Link>
          </Button>
        </div>
      </div>

      {collection.description && (
        <Card>
          <CardContent className="p-4">
            <p className="text-muted-foreground">{collection.description}</p>
          </CardContent>
        </Card>
      )}

      {/* Search and Filters */}
      <Card>
        <CardContent className="p-4">
          <div className="flex flex-col md:flex-row gap-4 items-center justify-between">
            <div className="flex-1 flex items-center gap-2">
              <div className="relative flex-1 max-w-md">
                <Search className="absolute left-3 top-1/2 transform -translate-y-1/2 h-4 w-4 text-muted-foreground" />
                <input
                  type="text"
                  placeholder={tCommon("search")}
                  value={searchTerm}
                  onChange={(e) => setSearchTerm(e.target.value)}
                  className="w-full pl-10 pr-4 py-2 border rounded-md focus:outline-none focus:ring-2 focus:ring-primary"
                />
              </div>
            </div>

            <div className="flex items-center gap-2">
              <Button
                variant={viewMode === "grid" ? "default" : "outline"}
                size="sm"
                onClick={() => setViewMode("grid")}
              >
                <Grid className="h-4 w-4" />
              </Button>
              <Button
                variant={viewMode === "list" ? "default" : "outline"}
                size="sm"
                onClick={() => setViewMode("list")}
              >
                <List className="h-4 w-4" />
              </Button>
            </div>
          </div>
        </CardContent>
      </Card>

      {/* Puzzles Grid/List */}
      {filteredPuzzles.length === 0 ? (
        <Card>
          <CardContent className="p-12 text-center">
            <div className="text-muted-foreground mb-4">
              <div className="w-16 h-16 mx-auto mb-4 rounded-full bg-muted flex items-center justify-center">
                <Plus className="h-8 w-8" />
              </div>
              <h3 className="text-lg font-medium mb-2">
                {t("noPuzzlesInCollection")}
              </h3>
              <p className="text-sm">{t("addPuzzlesToCollection")}</p>
            </div>
            <Button asChild>
              <Link href={`/collections/${id}/add-puzzles`}>
                <Plus className="h-4 w-4 mr-2" />
                {t("addPuzzles")}
              </Link>
            </Button>
          </CardContent>
        </Card>
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
