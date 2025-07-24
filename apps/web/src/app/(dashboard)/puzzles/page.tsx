"use client";

import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { PuzzleCard, PuzzleViewProvider } from "@/components/ui/puzzle-card";
import { useUser } from "@clerk/nextjs";
import { api } from "@jigswap/backend/convex/_generated/api";
import { Id } from "@jigswap/backend/convex/_generated/dataModel";
import { useMutation, useQuery } from "convex/react";
import { Filter, Grid, List, Plus, Search } from "lucide-react";
import { useTranslations } from "next-intl";
import { useRouter } from "next/navigation";
import { useState } from "react";

export default function PuzzlesPage() {
  const { user } = useUser();
  const router = useRouter();
  const t = useTranslations("puzzles");
  const tCommon = useTranslations("common");
  const [viewMode, setViewMode] = useState<"grid" | "list">("grid");
  const [searchTerm, setSearchTerm] = useState("");

  const convexUser = useQuery(
    api.users.getUserByClerkId,
    user?.id ? { clerkId: user.id } : "skip",
  );

  const userPuzzleInstances = useQuery(
    api.puzzles.getPuzzleInstancesByOwner,
    convexUser?._id
      ? { ownerId: convexUser._id, includeUnavailable: true }
      : "skip",
  );

  const deletePuzzle = useMutation(api.puzzles.deletePuzzleInstance);

  const handleDeletePuzzle = async (puzzleId: string) => {
    if (confirm("Are you sure you want to delete this puzzle?")) {
      try {
        await deletePuzzle({
          instanceId: puzzleId as Id<"puzzleInstances">,
        });
      } catch (error) {
        console.error("Failed to delete puzzle:", error);
      }
    }
  };

  const handleEditPuzzle = (puzzleId: Id<"puzzleInstances">) => {
    router.push(`/puzzles/${puzzleId}/edit`);
  };

  const handleViewPuzzle = (puzzleId: Id<"puzzleInstances">) => {
    router.push(`/puzzles/${puzzleId}`);
  };

  // Filter puzzle instances based on search term
  const filteredPuzzleInstances =
    userPuzzleInstances?.filter(
      (instance) =>
        instance.product?.title
          .toLowerCase()
          .includes(searchTerm.toLowerCase()) ||
        (instance.product?.brand &&
          instance.product.brand
            .toLowerCase()
            .includes(searchTerm.toLowerCase())),
    ) || [];

  if (!user || !convexUser || userPuzzleInstances === undefined) {
    return (
      <div className="flex items-center justify-center min-h-[400px]">
        <div className="text-center">
          <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-primary mx-auto mb-4"></div>
          <p className="text-muted-foreground">{tCommon("loading")}</p>
        </div>
      </div>
    );
  }

  return (
    <div className="container mx-auto space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-3xl font-bold">{t("myPuzzles")}</h1>
          <p className="text-muted-foreground">{t("managePuzzles")}</p>
        </div>
        <Button onClick={() => router.push("/puzzles/add")}>
          <Plus className="h-4 w-4 mr-2" />
          {t("addPuzzle")}
        </Button>
      </div>

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
              <Button variant="outline" size="sm">
                <Filter className="h-4 w-4 mr-2" />
                {tCommon("filter")}
              </Button>
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
      {filteredPuzzleInstances.length === 0 ? (
        <Card>
          <CardContent className="p-12 text-center">
            <div className="text-muted-foreground mb-4">
              <div className="w-16 h-16 mx-auto mb-4 rounded-full bg-muted flex items-center justify-center">
                <Plus className="h-8 w-8" />
              </div>
              <h3 className="text-lg font-medium mb-2">{t("noPuzzles")}</h3>
              <p className="text-sm">{t("addFirstPuzzle")}</p>
            </div>
            <Button onClick={() => router.push("/puzzles/add")}>
              <Plus className="h-4 w-4 mr-2" />
              {t("addPuzzle")}
            </Button>
          </CardContent>
        </Card>
      ) : (
        <PuzzleViewProvider viewMode={viewMode}>
          {filteredPuzzleInstances.map((instance) => (
            <PuzzleCard
              key={instance._id}
              puzzle={instance}
              variant="default"
              showCollectionDropdown={true}
              onEdit={handleEditPuzzle}
              onView={handleViewPuzzle}
              onDelete={handleDeletePuzzle}
            />
          ))}
        </PuzzleViewProvider>
      )}
    </div>
  );
}
