"use client";

import { Badge } from "@/components/ui/badge";
import { Id } from "@jigswap/backend/convex/_generated/dataModel";
import { useTranslations } from "next-intl";

interface PuzzleInstanceData {
  _id: Id<"ownedPuzzles">;
  productId: Id<"puzzles">;
  ownerId: Id<"users">;
  condition: "excellent" | "good" | "fair" | "poor";
  isAvailable: boolean;
  acquisitionDate?: number;
  notes?: string;
  createdAt: number;
  updatedAt: number;
  _creationTime?: number;
  product: {
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
  puzzle: PuzzleInstanceData;
}

export function PuzzleDetailHeader({ puzzle }: PuzzleDetailHeaderProps) {
  const t = useTranslations("puzzles");

  // Early return if no product data
  if (!puzzle.product) {
    return <div>Puzzle not found</div>;
  }

  return (
    <div className="space-y-4">
      <div className="flex items-start justify-between">
        <div className="space-y-2">
          <h1 className="text-3xl font-bold">{puzzle.product.title}</h1>
          {puzzle.product.brand && (
            <p className="text-lg text-muted-foreground">
              {puzzle.product.brand}
            </p>
          )}
        </div>
        <div className="flex items-center gap-2">
          <Badge
            variant={puzzle.isAvailable ? "default" : "secondary"}
            className="text-sm"
          >
            {puzzle.isAvailable ? t("available") : t("unavailable")}
          </Badge>
          <Badge variant="outline" className="text-sm">
            {puzzle.condition}
          </Badge>
        </div>
      </div>

      {puzzle.product.description && (
        <p className="text-muted-foreground">{puzzle.product.description}</p>
      )}
    </div>
  );
}
