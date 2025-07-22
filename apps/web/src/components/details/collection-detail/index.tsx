"use client";

import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { PageLoading } from "@/components/ui/loading";
import { PuzzleCard, PuzzleViewProvider } from "@/components/ui/puzzle-card";
import { api } from "@jigswap/backend/convex/_generated/api";
import { Id } from "@jigswap/backend/convex/_generated/dataModel";
import { useMutation, useQuery } from "convex/react";
import { Grid, List, Plus, Search } from "lucide-react";
import { useTranslations } from "next-intl";
import { useRouter } from "next/navigation";
import { useState } from "react";

import { CollectionDetailActions } from "./collection-detail-actions";
import { CollectionDetailHeader } from "./collection-detail-header";

interface CollectionDetailProps {
  collectionId: Id<"collections">;
  showActions?: boolean;
  onEdit?: (collectionId: Id<"collections">) => void;
  onAddPuzzles?: (collectionId: Id<"collections">) => void;
  className?: string;
}

export function CollectionDetail({
  collectionId,
  showActions = true,
  onEdit,
  onAddPuzzles,
  className = "",
}: CollectionDetailProps) {
  const router = useRouter();
  const t = useTranslations("collections");
  const tCommon = useTranslations("common");
  const [viewMode, setViewMode] = useState<"grid" | "list">("grid");
  const [searchTerm, setSearchTerm] = useState("");

  const collection = useQuery(api.collections.getCollectionById, {
    collectionId,
  });

  const removeFromCollection = useMutation(
    api.collections.removePuzzleFromCollection,
  );

  const handleRemovePuzzle = async (puzzleId: Id<"puzzles">) => {
    try {
      await removeFromCollection({
        collectionId,
        puzzleId,
      });
    } catch (error) {
      console.error("Failed to remove puzzle from collection:", error);
    }
  };

  const handleEditCollection = () => {
    if (onEdit) {
      onEdit(collectionId);
    } else {
      router.push(`/collections/${collectionId}/edit`);
    }
  };

  const handleAddPuzzles = () => {
    if (onAddPuzzles) {
      onAddPuzzles(collectionId);
    } else {
      router.push(`/collections/${collectionId}/add-puzzles`);
    }
  };

  // Filter puzzles based on search term
  const filteredPuzzles =
    collection?.puzzles
      ?.filter(
        (puzzle) =>
          puzzle &&
          (puzzle.title.toLowerCase().includes(searchTerm.toLowerCase()) ||
            (puzzle.brand &&
              puzzle.brand.toLowerCase().includes(searchTerm.toLowerCase()))),
      )
      .filter(Boolean) || [];

  if (collection === undefined) {
    return <PageLoading message={tCommon("loading")} />;
  }

  if (collection === null) {
    return <div>{t("notFound")}</div>;
  }

  return (
    <div className={`space-y-6 ${className}`}>
      <CollectionDetailHeader
        collection={collection}
        onEdit={showActions ? handleEditCollection : undefined}
        onAddPuzzles={showActions ? handleAddPuzzles : undefined}
      />

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
            <Button onClick={handleAddPuzzles}>
              <Plus className="h-4 w-4 mr-2" />
              {t("addPuzzles")}
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

      {showActions && (
        <CollectionDetailActions
          collection={collection}
          onEdit={handleEditCollection}
          onAddPuzzles={handleAddPuzzles}
        />
      )}
    </div>
  );
}
