"use client";

import { Badge } from "@/components/ui/badge";
import { Id } from "@jigswap/backend/convex/_generated/dataModel";
import { useTranslations } from "next-intl";

interface OwnedPuzzleData {
  _id: Id<"ownedPuzzles">;
  puzzleId: Id<"puzzles">;
  ownerId: Id<"users">;
  condition: "new_sealed" | "like_new" | "good" | "fair" | "poor";
  availability: {
    forTrade: boolean;
    forSale: boolean;
    forLend: boolean;
  };
  acquisitionDate?: number;
  notes?: string;
  createdAt: number;
  updatedAt: number;
  _creationTime?: number;
  puzzle: {
    _id: Id<"puzzles">;
    title: string;
    description?: string;
    brand?: string;
    pieceCount: number;
    difficulty?: "easy" | "medium" | "hard" | "expert";
    category?: Id<"adminCategories">;
    tags?: string[];
    images?: string[];
    createdAt: number;
    updatedAt: number;
    _creationTime?: number;
  } | null;
  owner?: {
    _id: Id<"users">;
    name: string;
    username?: string;
    avatar?: string;
  } | null;
}

interface PuzzleDetailHeaderProps {
  puzzle: OwnedPuzzleData;
}

export function PuzzleDetailHeader({ puzzle }: PuzzleDetailHeaderProps) {
  const t = useTranslations("puzzles");

  // Early return if no product data
  if (!puzzle.puzzle) {
    return <div>Puzzle not found</div>;
  }

  return (
    <div className="space-y-4">
      <div className="flex items-start justify-between">
        <div className="space-y-2">
          <h1 className="text-3xl font-bold">{puzzle.puzzle.title}</h1>
          {puzzle.puzzle.brand && (
            <p className="text-lg text-muted-foreground">
              {puzzle.puzzle.brand}
            </p>
          )}
        </div>
        <div className="flex items-center gap-2">
          {puzzle.availability.forTrade && (
            <Badge variant="outline" className="text-sm">
              {t("forTrade")}
            </Badge>
          )}
          {puzzle.availability.forSale && (
            <Badge variant="outline" className="text-sm">
              {t("forSale")}
            </Badge>
          )}
          {puzzle.availability.forLend && (
            <Badge variant="outline" className="text-sm">
              {t("forLend")}
            </Badge>
          )}
          <Badge variant="outline" className="text-sm">
            {puzzle.condition}
          </Badge>
        </div>
      </div>

      {puzzle.puzzle.description && (
        <p className="text-muted-foreground">{puzzle.puzzle.description}</p>
      )}
    </div>
  );
}
