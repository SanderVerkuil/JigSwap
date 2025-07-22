"use client";

import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { PageLoading } from "@/components/ui/loading";
import { PuzzleCard, PuzzleViewProvider } from "@/components/ui/puzzle-card";
import { useUser } from "@clerk/nextjs";
import { api } from "@jigswap/backend/convex/_generated/api";
import { Id } from "@jigswap/backend/convex/_generated/dataModel";
import { useMutation, useQuery } from "convex/react";
import { Grid, Plus, Search } from "lucide-react";
import { useTranslations } from "next-intl";
import { useParams, useRouter } from "next/navigation";
import { useState } from "react";

export default function AddPuzzlesToCollectionPage() {
  const { id } = useParams();
  const { user } = useUser();
  const router = useRouter();
  const t = useTranslations("collections");
  const tCommon = useTranslations("common");
  const [searchTerm, setSearchTerm] = useState("");
  const [selectedPuzzles, setSelectedPuzzles] = useState<
    Set<Id<"puzzleInstances">>
  >(new Set());

  const convexUser = useQuery(
    api.users.getUserByClerkId,
    user?.id ? { clerkId: user.id } : "skip",
  );

  const collection = useQuery(api.collections.getCollectionById, {
    collectionId: id as Id<"collections">,
  });

  const availablePuzzles = useQuery(
    api.puzzles.getPuzzleInstancesByOwner,
    convexUser?._id
      ? { ownerId: convexUser._id, includeUnavailable: false }
      : "skip",
  );

  const addPuzzleToCollection = useMutation(
    api.collections.addPuzzleInstanceToCollection,
  );

  const togglePuzzleSelection = (puzzleId: Id<"puzzleInstances">) => {
    const newSelected = new Set(selectedPuzzles);
    if (newSelected.has(puzzleId)) {
      newSelected.delete(puzzleId);
    } else {
      newSelected.add(puzzleId);
    }
    setSelectedPuzzles(newSelected);
  };

  const handleAddSelectedPuzzles = async () => {
    try {
      for (const puzzleId of selectedPuzzles) {
        await addPuzzleToCollection({
          collectionId: id as Id<"collections">,
          puzzleInstanceId: puzzleId,
        });
      }
      router.push(`/collections/${id}`);
    } catch (error) {
      console.error("Failed to add puzzles to collection:", error);
    }
  };

  // Filter puzzles based on search term
  const filteredPuzzles =
    availablePuzzles
      ?.filter(
        (puzzle) =>
          !collection?.puzzles.map((p) => p?._id).includes(puzzle._id),
      )
      ?.filter(
        (puzzle) =>
          puzzle.product?.title
            .toLowerCase()
            .includes(searchTerm.toLowerCase()) ||
          (puzzle.product?.brand &&
            puzzle.product.brand
              .toLowerCase()
              .includes(searchTerm.toLowerCase())),
      ) || [];

  if (
    collection === undefined ||
    availablePuzzles === undefined ||
    convexUser === undefined
  ) {
    return <PageLoading message={tCommon("loading")} />;
  }

  if (collection === null) {
    return <div>{t("notFound")}</div>;
  }

  return (
    <div className="container mx-auto space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-3xl font-bold">{t("addPuzzlesToCollection")}</h1>
          <p className="text-muted-foreground">
            {t("selectPuzzlesToAdd")} &quot;{collection.name}&quot;
          </p>
        </div>
        <div className="flex items-center gap-2">
          <Button
            variant="outline"
            onClick={() => router.push(`/collections/${id}`)}
          >
            Cancel
          </Button>
          <Button
            onClick={handleAddSelectedPuzzles}
            disabled={selectedPuzzles.size === 0}
          >
            <Plus className="h-4 w-4 mr-2" />
            Add {selectedPuzzles.size} Puzzle
            {selectedPuzzles.size !== 1 ? "s" : ""}
          </Button>
        </div>
      </div>

      {/* Search */}
      <Card>
        <CardContent className="p-4">
          <div className="relative">
            <Search className="absolute left-3 top-1/2 transform -translate-y-1/2 h-4 w-4 text-muted-foreground" />
            <input
              type="text"
              placeholder={tCommon("search")}
              value={searchTerm}
              onChange={(e) => setSearchTerm(e.target.value)}
              className="w-full pl-10 pr-4 py-2 border rounded-md focus:outline-none focus:ring-2 focus:ring-primary"
            />
          </div>
        </CardContent>
      </Card>

      {/* Puzzles Grid */}
      {filteredPuzzles.length === 0 ? (
        <Card>
          <CardContent className="p-12 text-center">
            <div className="text-muted-foreground">
              <div className="w-16 h-16 mx-auto mb-4 rounded-full bg-muted flex items-center justify-center">
                <Grid className="h-8 w-8" />
              </div>
              <h3 className="text-lg font-medium mb-2">
                {t("noPuzzlesAvailable")}
              </h3>
              <p className="text-sm">{t("addPuzzlesFirst")}</p>
            </div>
          </CardContent>
        </Card>
      ) : (
        <PuzzleViewProvider viewMode="grid">
          {filteredPuzzles.map((puzzle) => (
            <PuzzleCard
              key={puzzle._id}
              puzzle={puzzle}
              variant="selection"
              isSelected={selectedPuzzles.has(puzzle._id)}
              onSelect={togglePuzzleSelection}
            />
          ))}
        </PuzzleViewProvider>
      )}
    </div>
  );
}
