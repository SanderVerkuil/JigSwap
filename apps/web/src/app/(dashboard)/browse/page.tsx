"use client";

import { useUser } from "@clerk/nextjs";
import { api } from "@jigswap/backend/convex/_generated/api";
import { useQuery } from "convex/react";
import { Grid, Heart, List, MessageCircle, Search, User } from "lucide-react";
import { useTranslations } from "next-intl";
import Image from "next/image";
import { useState } from "react";
import { Badge } from "../../../components/ui/badge";
import { Button } from "../../../components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "../../../components/ui/card";

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

  const browsePuzzlesResult = useQuery(api.puzzles.browsePuzzles, {
    searchTerm: searchTerm || undefined,
    category: selectedCategory || undefined,
    difficulty: (selectedDifficulty as Difficulty) || undefined,
    condition: (selectedCondition as Condition) || undefined,
    minPieceCount: minPieces ? parseInt(minPieces) : undefined,
    maxPieceCount: maxPieces ? parseInt(maxPieces) : undefined,
    excludeOwnerId: convexUser?._id,
    limit: 50,
  });

  const categories = useQuery(api.puzzles.getPuzzleCategories);

  const puzzles = browsePuzzlesResult?.puzzles || [];
  const totalPuzzles = browsePuzzlesResult?.total || 0;

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

  if (!user || !convexUser) {
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
    <div className="container mx-auto p-6 space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-3xl font-bold">{tBrowse("title")}</h1>
          <p className="text-muted-foreground">
            {tBrowse("subtitle")} ({totalPuzzles} {tBrowse("puzzlesFound")})
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
                    <option key={category} value={category}>
                      {category}
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
      {puzzles.length === 0 ? (
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
        <div
          className={
            viewMode === "grid"
              ? "grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-6"
              : "space-y-4"
          }
        >
          {puzzles.map((puzzle) => (
            <Card
              key={puzzle._id}
              className={`group hover:shadow-lg transition-shadow ${viewMode === "list" ? "flex" : ""}`}
            >
              {viewMode === "grid" ? (
                <>
                  <div className="aspect-square bg-muted rounded-t-lg relative overflow-hidden">
                    {puzzle.images && puzzle.images.length > 0 ? (
                      <Image
                        src={puzzle.images[0]}
                        alt={puzzle.title}
                        className="w-full h-full object-cover group-hover:scale-105 transition-transform duration-200"
                      />
                    ) : (
                      <div className="w-full h-full flex items-center justify-center text-muted-foreground">
                        <div className="text-center">
                          <div className="w-12 h-12 mx-auto mb-2 rounded bg-muted-foreground/10 flex items-center justify-center">
                            <Grid className="h-6 w-6" />
                          </div>
                          <p className="text-sm">{t("noImage")}</p>
                        </div>
                      </div>
                    )}
                    <div className="absolute top-2 right-2">
                      <Button
                        variant="ghost"
                        size="sm"
                        className="bg-white/80 hover:bg-white"
                      >
                        <Heart className="h-4 w-4" />
                      </Button>
                    </div>
                  </div>
                  <CardHeader className="pb-2">
                    <CardTitle className="text-lg line-clamp-1">
                      {puzzle.title}
                    </CardTitle>
                    <CardDescription className="line-clamp-2">
                      {puzzle.brand && (
                        <span className="font-medium">{puzzle.brand}</span>
                      )}
                      {puzzle.brand && puzzle.pieceCount && " • "}
                      {puzzle.pieceCount && (
                        <span>
                          {puzzle.pieceCount} {t("pieces")}
                        </span>
                      )}
                    </CardDescription>
                  </CardHeader>
                  <CardContent className="pt-0">
                    <div className="space-y-3">
                      <div className="flex items-center gap-2">
                        {puzzle.difficulty && (
                          <Badge variant="outline" className="text-xs">
                            {puzzle.difficulty}
                          </Badge>
                        )}
                        {puzzle.condition && (
                          <Badge variant="outline" className="text-xs">
                            {puzzle.condition}
                          </Badge>
                        )}
                      </div>

                      {puzzle.owner && (
                        <div className="flex items-center gap-2 text-sm text-muted-foreground">
                          <User className="h-3 w-3" />
                          <span>{puzzle.owner.name}</span>
                        </div>
                      )}

                      <div className="flex items-center gap-2">
                        <Button size="sm" className="flex-1">
                          {t("requestTrade")}
                        </Button>
                        <Button variant="outline" size="sm">
                          <MessageCircle className="h-4 w-4" />
                        </Button>
                      </div>
                    </div>
                  </CardContent>
                </>
              ) : (
                <div className="flex w-full">
                  <div className="w-32 h-32 bg-muted rounded-l-lg flex-shrink-0 overflow-hidden">
                    {puzzle.images && puzzle.images.length > 0 ? (
                      <Image
                        src={puzzle.images[0]}
                        alt={puzzle.title}
                        className="w-full h-full object-cover object-center"
                      />
                    ) : (
                      <div className="w-full h-full flex items-center justify-center text-muted-foreground">
                        <Grid className="h-6 w-6" />
                      </div>
                    )}
                  </div>
                  <div className="flex-1 p-4">
                    <div className="flex items-start justify-between h-full">
                      <div className="flex-1">
                        <h3 className="font-semibold text-lg mb-1">
                          {puzzle.title}
                        </h3>
                        <p className="text-sm text-muted-foreground mb-2">
                          {puzzle.brand && (
                            <span className="font-medium">{puzzle.brand}</span>
                          )}
                          {puzzle.brand && puzzle.pieceCount && " • "}
                          {puzzle.pieceCount && (
                            <span>
                              {puzzle.pieceCount} {t("pieces")}
                            </span>
                          )}
                        </p>
                        <div className="flex items-center gap-2 mb-2">
                          {puzzle.difficulty && (
                            <Badge variant="outline" className="text-xs">
                              {puzzle.difficulty}
                            </Badge>
                          )}
                          {puzzle.condition && (
                            <Badge variant="outline" className="text-xs">
                              {puzzle.condition}
                            </Badge>
                          )}
                        </div>
                        {puzzle.owner && (
                          <div className="flex items-center gap-2 text-sm text-muted-foreground">
                            <User className="h-3 w-3" />
                            <span>{puzzle.owner.name}</span>
                          </div>
                        )}
                      </div>
                      <div className="flex flex-col items-end gap-2 ml-4">
                        <Button variant="ghost" size="sm">
                          <Heart className="h-4 w-4" />
                        </Button>
                        <Button size="sm">{t("requestTrade")}</Button>
                        <Button variant="outline" size="sm">
                          <MessageCircle className="h-4 w-4" />
                        </Button>
                      </div>
                    </div>
                  </div>
                </div>
              )}
            </Card>
          ))}
        </div>
      )}
    </div>
  );
}
