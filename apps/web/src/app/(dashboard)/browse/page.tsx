"use client";

import { PageLoading } from "@/components/ui/loading";
import { useUser } from "@clerk/nextjs";
import { api } from "@jigswap/backend/convex/_generated/api";
import { Id } from "@jigswap/backend/convex/_generated/dataModel";
import { useQuery } from "convex/react";
import { Grid, List, Search } from "lucide-react";
import { useTranslations } from "next-intl";
import { useState } from "react";
import { Button } from "../../../components/ui/button";
import { Card, CardContent } from "../../../components/ui/card";
import {
  PuzzleCard,
  PuzzleViewProvider,
} from "../../../components/ui/puzzle-card";

export default function BrowsePage() {
  const { user } = useUser();
  const t = useTranslations("puzzles");
  const tCommon = useTranslations("common");
  const tBrowse = useTranslations("browse");

  const [viewMode, setViewMode] = useState<"grid" | "list">("grid");
  const [searchTerm, setSearchTerm] = useState("");
  const [selectedCategory, setSelectedCategory] = useState("");
  const [selectedDifficulty, setSelectedDifficulty] = useState("");
  const [selectedCondition, setSelectedCondition] = useState("");
  const [minPieces, setMinPieces] = useState("");
  const [maxPieces, setMaxPieces] = useState("");

  type Difficulty = "easy" | "medium" | "hard" | "expert";
  type Condition = "excellent" | "good" | "fair" | "poor";

  const convexUser = useQuery(
    api.users.getUserByClerkId,
    user?.id ? { clerkId: user.id } : "skip",
  );

  const browseownedPuzzlesResult = useQuery(api.puzzles.browseownedPuzzles, {
    searchTerm: searchTerm || undefined,
    category: selectedCategory
      ? (selectedCategory as Id<"adminCategories">)
      : undefined,
    difficulty: (selectedDifficulty as Difficulty) || undefined,
    condition: (selectedCondition as Condition) || undefined,
    minPieceCount: minPieces ? parseInt(minPieces) : undefined,
    maxPieceCount: maxPieces ? parseInt(maxPieces) : undefined,
    excludeOwnerId: convexUser?._id,
    limit: 50,
  });

  const categories = useQuery(api.puzzles.getPuzzleCategories);

  const ownedPuzzles = browseownedPuzzlesResult?.instances || [];
  const totalownedPuzzles = browseownedPuzzlesResult?.total || 0;

  const clearFilters = () => {
    setSearchTerm("");
    setSelectedCategory("");
    setSelectedDifficulty("");
    setSelectedCondition("");
    setMinPieces("");
    setMaxPieces("");
  };

  const hasActiveFilters =
    searchTerm ||
    selectedCategory ||
    selectedDifficulty ||
    selectedCondition ||
    minPieces ||
    maxPieces;

  if (
    !user ||
    convexUser === undefined ||
    browseownedPuzzlesResult === undefined
  ) {
    return <PageLoading message={tCommon("loading")} />;
  }

  return (
    <div className="container mx-auto space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-3xl font-bold">{tBrowse("title")}</h1>
          <p className="text-muted-foreground">
            {tBrowse("subtitle")} ({totalownedPuzzles} {tBrowse("puzzlesFound")}
            )
          </p>
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

      {/* Search and Filters */}
      <Card>
        <CardContent className="p-6">
          <div className="space-y-4">
            {/* Search Bar */}
            <div className="relative">
              <Search className="absolute left-3 top-1/2 transform -translate-y-1/2 h-4 w-4 text-muted-foreground" />
              <input
                type="text"
                placeholder={tBrowse("searchPlaceholder")}
                value={searchTerm}
                onChange={(e) => setSearchTerm(e.target.value)}
                className="w-full pl-10 pr-4 py-3 border rounded-md focus:outline-none focus:ring-2 focus:ring-primary text-lg"
              />
            </div>

            {/* Filters */}
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 xl:grid-cols-6 gap-4">
              <div>
                <label className="block text-sm font-medium mb-2">
                  {t("category")}
                </label>
                <select
                  value={selectedCategory}
                  onChange={(e) => setSelectedCategory(e.target.value)}
                  className="w-full px-3 py-2 border rounded-md focus:outline-none focus:ring-2 focus:ring-primary"
                >
                  <option value="">{tBrowse("allCategories")}</option>
                  {categories?.map((category) => (
                    <option key={category._id} value={category._id}>
                      {category.name.en}
                    </option>
                  ))}
                </select>
              </div>

              <div>
                <label className="block text-sm font-medium mb-2">
                  {t("difficulty")}
                </label>
                <select
                  value={selectedDifficulty}
                  onChange={(e) => setSelectedDifficulty(e.target.value)}
                  className="w-full px-3 py-2 border rounded-md focus:outline-none focus:ring-2 focus:ring-primary"
                >
                  <option value="">{tBrowse("allDifficulties")}</option>
                  <option value="easy">{t("easy")}</option>
                  <option value="medium">{t("medium")}</option>
                  <option value="hard">{t("hard")}</option>
                  <option value="expert">{t("expert")}</option>
                </select>
              </div>

              <div>
                <label className="block text-sm font-medium mb-2">
                  {t("condition")}
                </label>
                <select
                  value={selectedCondition}
                  onChange={(e) => setSelectedCondition(e.target.value)}
                  className="w-full px-3 py-2 border rounded-md focus:outline-none focus:ring-2 focus:ring-primary"
                >
                  <option value="">{tBrowse("allConditions")}</option>
                  <option value="excellent">{t("excellent")}</option>
                  <option value="good">{t("good")}</option>
                  <option value="fair">{t("fair")}</option>
                  <option value="poor">{t("poor")}</option>
                </select>
              </div>

              <div>
                <label className="block text-sm font-medium mb-2">
                  {tBrowse("minPieces")}
                </label>
                <input
                  type="number"
                  placeholder="100"
                  value={minPieces}
                  onChange={(e) => setMinPieces(e.target.value)}
                  className="w-full px-3 py-2 border rounded-md focus:outline-none focus:ring-2 focus:ring-primary"
                />
              </div>

              <div>
                <label className="block text-sm font-medium mb-2">
                  {tBrowse("maxPieces")}
                </label>
                <input
                  type="number"
                  placeholder="5000"
                  value={maxPieces}
                  onChange={(e) => setMaxPieces(e.target.value)}
                  className="w-full px-3 py-2 border rounded-md focus:outline-none focus:ring-2 focus:ring-primary"
                />
              </div>

              <div className="flex items-end">
                {hasActiveFilters && (
                  <Button
                    variant="outline"
                    onClick={clearFilters}
                    className="w-full"
                  >
                    {tBrowse("clearFilters")}
                  </Button>
                )}
              </div>
            </div>
          </div>
        </CardContent>
      </Card>

      {/* Results */}
      {ownedPuzzles.length === 0 ? (
        <Card>
          <CardContent className="p-12 text-center">
            <div className="text-muted-foreground">
              <div className="w-16 h-16 mx-auto mb-4 rounded-full bg-muted flex items-center justify-center">
                <Search className="h-8 w-8" />
              </div>
              <h3 className="text-lg font-medium mb-2">
                {tBrowse("noPuzzlesFound")}
              </h3>
              <p className="text-sm">{tBrowse("tryDifferentFilters")}</p>
            </div>
          </CardContent>
        </Card>
      ) : (
        <PuzzleViewProvider viewMode={viewMode}>
          {ownedPuzzles.map((puzzleInstance) => (
            <PuzzleCard
              key={puzzleInstance._id}
              puzzle={puzzleInstance}
              variant="browse"
              showOwner={true}
              onRequestTrade={(puzzleId) => {
                // Handle trade request
                console.log("Request trade for puzzle:", puzzleId);
              }}
              onMessage={(puzzleId) => {
                // Handle message
                console.log("Message for puzzle:", puzzleId);
              }}
              onFavorite={(puzzleId) => {
                // Handle favorite
                console.log("Favorite puzzle:", puzzleId);
              }}
            />
          ))}
        </PuzzleViewProvider>
      )}
    </div>
  );
}
