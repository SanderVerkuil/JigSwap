"use client";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { useUser } from "@clerk/nextjs";
import { api } from "@jigswap/backend/convex/_generated/api";
import { Id } from "@jigswap/backend/convex/_generated/dataModel";
import { useMutation, useQuery } from "convex/react";
import {
  Edit,
  Eye,
  Filter,
  Grid,
  List,
  Plus,
  Search,
  Trash2,
} from "lucide-react";
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

  const userPuzzles = useQuery(
    api.puzzles.getPuzzlesByOwner,
    convexUser?._id
      ? { ownerId: convexUser._id, includeUnavailable: true }
      : "skip",
  );

  const deletePuzzle = useMutation(api.puzzles.deletePuzzle);

  const handleDeletePuzzle = async (puzzleId: string) => {
    if (confirm("Are you sure you want to delete this puzzle?")) {
      try {
        await deletePuzzle({ puzzleId: puzzleId as Id<"puzzles"> });
      } catch (error) {
        console.error("Failed to delete puzzle:", error);
      }
    }
  };

  const filteredPuzzles =
    userPuzzles?.filter(
      (puzzle) =>
        puzzle.title.toLowerCase().includes(searchTerm.toLowerCase()) ||
        puzzle.brand?.toLowerCase().includes(searchTerm.toLowerCase()) ||
        puzzle.category?.toLowerCase().includes(searchTerm.toLowerCase()),
    ) || [];

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
          <h1 className="text-3xl font-bold">{t("myPuzzles")}</h1>
          <p className="text-muted-foreground">{t("managePuzzles")}</p>
        </div>
        <Button
          className="flex items-center gap-2"
          onClick={() => router.push("/puzzles/add")}
        >
          <Plus className="h-4 w-4" />
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
      {filteredPuzzles.length === 0 ? (
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
        <div
          className={
            viewMode === "grid"
              ? "grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-6"
              : "space-y-4"
          }
        >
          {filteredPuzzles.map((puzzle) => (
            <Card
              key={puzzle._id}
              className={viewMode === "list" ? "flex" : ""}
            >
              {viewMode === "grid" ? (
                <>
                  <div className="aspect-square bg-muted rounded-t-lg relative overflow-hidden">
                    {puzzle.images && puzzle.images.length > 0 ? (
                      <img
                        src={puzzle.images[0]}
                        alt={puzzle.title}
                        className="w-full h-full object-cover"
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
                      <Badge
                        variant={puzzle.isAvailable ? "default" : "secondary"}
                      >
                        {puzzle.isAvailable ? t("available") : t("unavailable")}
                      </Badge>
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
                    <div className="flex items-center justify-between">
                      <div className="flex items-center gap-1">
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
                      <div className="flex items-center gap-1">
                        <Button variant="ghost" size="sm">
                          <Eye className="h-4 w-4" />
                        </Button>
                        <Button variant="ghost" size="sm">
                          <Edit className="h-4 w-4" />
                        </Button>
                        <Button
                          variant="ghost"
                          size="sm"
                          onClick={() => handleDeletePuzzle(puzzle._id)}
                        >
                          <Trash2 className="h-4 w-4" />
                        </Button>
                      </div>
                    </div>
                  </CardContent>
                </>
              ) : (
                <div className="flex w-full">
                  <div className="w-24 h-24 bg-muted rounded-l-lg flex-shrink-0 overflow-hidden">
                    {puzzle.images && puzzle.images.length > 0 ? (
                      <img
                        src={puzzle.images[0]}
                        alt={puzzle.title}
                        className="w-full h-full object-cover"
                      />
                    ) : (
                      <div className="w-full h-full flex items-center justify-center text-muted-foreground">
                        <Grid className="h-6 w-6" />
                      </div>
                    )}
                  </div>
                  <div className="flex-1 p-4">
                    <div className="flex items-start justify-between">
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
                        <div className="flex items-center gap-2">
                          <Badge
                            variant={
                              puzzle.isAvailable ? "default" : "secondary"
                            }
                          >
                            {puzzle.isAvailable
                              ? t("available")
                              : t("unavailable")}
                          </Badge>
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
                      </div>
                      <div className="flex items-center gap-1 ml-4">
                        <Button variant="ghost" size="sm">
                          <Eye className="h-4 w-4" />
                        </Button>
                        <Button variant="ghost" size="sm">
                          <Edit className="h-4 w-4" />
                        </Button>
                        <Button
                          variant="ghost"
                          size="sm"
                          onClick={() => handleDeletePuzzle(puzzle._id)}
                        >
                          <Trash2 className="h-4 w-4" />
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
