"use client";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader } from "@/components/ui/card";
import { Id } from "@jigswap/backend/convex/_generated/dataModel";
import { Eye, Plus } from "lucide-react";
import { useTranslations } from "next-intl";
import Image from "next/image";
import Link from "next/link";
import { usePuzzleProductView } from "./puzzle-view-provider";

interface Puzzle {
  _id: Id<"puzzles">;
  title: string;
  description?: string;
  brand?: string;
  pieceCount: number;
  difficulty?: "easy" | "medium" | "hard" | "expert";
  category?: Id<"adminCategories">;
  tags?: string[];
  image?: string | null;
  createdAt: number;
  updatedAt: number;
}

interface PuzzleCardProps {
  puzzle: Puzzle;
}

export function PuzzleCard({ puzzle }: PuzzleCardProps) {
  const t = useTranslations("puzzles.products");
  const tPuzzles = useTranslations("puzzles");
  const { viewMode } = usePuzzleProductView();

  const getDifficultyColor = (difficulty?: string) => {
    switch (difficulty) {
      case "easy":
        return "bg-green-100 text-green-800";
      case "medium":
        return "bg-yellow-100 text-yellow-800";
      case "hard":
        return "bg-orange-100 text-orange-800";
      case "expert":
        return "bg-red-100 text-red-800";
      default:
        return "bg-gray-100 text-gray-800";
    }
  };

  const getDifficultyLabel = (difficulty?: string) => {
    switch (difficulty) {
      case "easy":
        return t("difficulty.easy");
      case "medium":
        return t("difficulty.medium");
      case "hard":
        return t("difficulty.hard");
      case "expert":
        return t("difficulty.expert");
      default:
        return t("difficulty.unknown");
    }
  };

  const renderImage = () => {
    if (puzzle.image) {
      return (
        <div
          className={`${viewMode === "list" ? "h-32" : "aspect-square"} overflow-hidden bg-muted`}
        >
          <Image
            src={puzzle.image}
            alt={puzzle.title}
            className="w-full h-full object-contain"
            width={viewMode === "list" ? 128 : 480}
            height={viewMode === "list" ? 128 : 480}
          />
        </div>
      );
    } else {
      return (
        <div
          className={`${viewMode === "list" ? "h-32" : "aspect-square"} bg-muted flex items-center justify-center`}
        >
          <div className="text-muted-foreground text-center">
            <div className="text-2xl mb-2">🧩</div>
            <div className="text-sm">{t("noImage")}</div>
          </div>
        </div>
      );
    }
  };

  const renderContent = () => {
    return (
      <div className="flex-1">
        <div className="flex items-start justify-between mb-2">
          <div className="flex-1 min-w-0">
            <h3 className="font-semibold text-lg leading-tight line-clamp-2">
              {puzzle.title}
            </h3>
            {puzzle.brand && (
              <p className="text-sm text-muted-foreground mt-1">
                {puzzle.brand}
              </p>
            )}
          </div>
        </div>

        {/* Description */}
        {puzzle.description && (
          <p className="text-sm text-muted-foreground mb-4 line-clamp-3">
            {puzzle.description}
          </p>
        )}

        {/* Product Details */}
        <div className="flex flex-row w-full space-y-2 mb-4">
          <div className="flex-1 flex items-start justify-between flex-col">
            <span className="text-sm font-bold">{tPuzzles("pieceCount")}</span>
            <span className="text-sm">
              {puzzle.pieceCount} {tPuzzles("pieces")}
            </span>
          </div>

          {puzzle.difficulty && (
            <div className="flex-1 flex items-start justify-between flex-col">
              <span className="text-sm font-bold">
                {tPuzzles("difficulty")}
              </span>
              <Badge
                variant="secondary"
                className={`text-xs ${getDifficultyColor(puzzle.difficulty)}`}
              >
                {getDifficultyLabel(puzzle.difficulty)}
              </Badge>
            </div>
          )}
        </div>

        {/* Tags */}
        {puzzle.tags && puzzle.tags.length > 0 && (
          <div className="flex flex-wrap gap-1 mb-4">
            {puzzle.tags.slice(0, 3).map((tag, index) => (
              <Badge key={index} variant="outline" className="text-xs">
                {tag}
              </Badge>
            ))}
            {puzzle.tags.length > 3 && (
              <Badge variant="outline" className="text-xs">
                +{puzzle.tags.length - 3}
              </Badge>
            )}
          </div>
        )}

        {/* Actions */}
        <div className="flex gap-2 mt-auto">
          <Button variant="outline" size="sm" asChild className="flex-1">
            <Link href={`/puzzles/${puzzle._id}`}>
              <Eye className="h-4 w-4 mr-2" />
              {t("viewDetails")}
            </Link>
          </Button>
          <Button size="sm" asChild className="flex-1">
            <Link href={`/my-puzzles/add?puzzleId=${puzzle._id}`}>
              <Plus className="h-4 w-4 mr-2" />
              {t("addPuzzle")}
            </Link>
          </Button>
        </div>
      </div>
    );
  };

  if (viewMode === "list") {
    return (
      <Card className="h-full">
        <div className="flex">
          <div className="w-32 self-center flex-shrink-0">{renderImage()}</div>
          <div className="flex-1 p-4">{renderContent()}</div>
        </div>
      </Card>
    );
  }

  return (
    <Card className="h-full flex flex-col p-0 pb-6 overflow-hidden">
      <CardHeader className="p-0 relative">
        {/* Product Image */}
        {renderImage()}

        <div className="absolute bottom-0 left-0 w-full py-3 hover:py-6 transition-all duration-300 bg-foreground/30 hover:bg-foreground/50 backdrop-blur-sm dark:bg-background/30 dark:hover:bg-background/50">
          <div className="flex items-end justify-end gap-2 px-6 pt-3">
            <div className="flex-1 min-w-0">
              <h3 className="font-semibold text-white dark:text-foreground text-lg leading-tight line-clamp-2">
                {puzzle.title}
              </h3>
              {puzzle.brand && (
                <p className="text-sm text-gray-50 dark:text-muted-foreground mt-1">
                  {puzzle.brand}
                </p>
              )}
            </div>
          </div>
        </div>
      </CardHeader>

      <CardContent className="flex-1 flex flex-col">
        {/* Description */}
        {puzzle.description && (
          <p className="text-sm text-muted-foreground mb-4 line-clamp-3">
            {puzzle.description}
          </p>
        )}

        {/* Product Details */}
        <div className="space-y-2 mb-4">
          <div className="flex items-center justify-between">
            <span className="text-sm font-medium">
              {tPuzzles("pieceCount")}
            </span>
            <span className="text-sm">
              {puzzle.pieceCount} {tPuzzles("pieces")}
            </span>
          </div>

          {puzzle.difficulty && (
            <div className="flex items-center justify-between">
              <span className="text-sm font-medium">
                {tPuzzles("difficulty")}
              </span>
              <Badge
                variant="secondary"
                className={`text-xs ${getDifficultyColor(puzzle.difficulty)}`}
              >
                {getDifficultyLabel(puzzle.difficulty)}
              </Badge>
            </div>
          )}
        </div>

        {/* Tags */}
        {puzzle.tags && puzzle.tags.length > 0 && (
          <div className="flex flex-wrap gap-1 mb-4">
            {puzzle.tags.slice(0, 3).map((tag, index) => (
              <Badge key={index} variant="outline" className="text-xs">
                {tag}
              </Badge>
            ))}
            {puzzle.tags.length > 3 && (
              <Badge variant="outline" className="text-xs">
                +{puzzle.tags.length - 3}
              </Badge>
            )}
          </div>
        )}

        {/* Actions */}
        <div className="flex gap-2 mt-auto">
          <Button variant="outline" size="sm" asChild className="flex-1">
            <Link href={`/puzzles/${puzzle._id}`}>
              <Eye className="h-4 w-4 mr-2" />
              {t("viewDetails")}
            </Link>
          </Button>
          <Button size="sm" asChild className="flex-1">
            <Link href={`/my-puzzles/add?puzzleId=${puzzle._id}`}>
              <Plus className="h-4 w-4 mr-2" />
              {t("addPuzzle")}
            </Link>
          </Button>
        </div>
      </CardContent>
    </Card>
  );
}
