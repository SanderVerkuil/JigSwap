"use client";

import { Badge } from "@/components/ui/badge";
import { Id } from "@jigswap/backend/convex/_generated/dataModel";
import { useTranslations } from "next-intl";

interface PuzzleData {
  _id: Id<"puzzles">;
  title: string;
  description?: string;
  brand?: string;
  pieceCount: number;
  difficulty?: "easy" | "medium" | "hard" | "expert";
  condition: "excellent" | "good" | "fair" | "poor";
  category?: Id<"adminCategories">;
  tags?: string[];
  images: string[];
  ownerId: Id<"users">;
  isAvailable: boolean;
  isCompleted: boolean;
  completedDate?: number;
  acquisitionDate?: number;
  notes?: string;
  createdAt: number;
  updatedAt: number;
  _creationTime?: number;
  owner?: {
    _id: Id<"users">;
    name: string;
    username?: string;
    avatar?: string;
  } | null;
}

interface PuzzleDetailHeaderProps {
  puzzle: PuzzleData;
}

export function PuzzleDetailHeader({ puzzle }: PuzzleDetailHeaderProps) {
  const t = useTranslations("puzzles");

  return (
    <div className="space-y-4">
      <div className="flex items-start justify-between">
        <div className="space-y-2">
          <h1 className="text-3xl font-bold">{puzzle.title}</h1>
          {puzzle.brand && (
            <p className="text-lg text-muted-foreground">{puzzle.brand}</p>
          )}
        </div>
        <div className="flex items-center gap-2">
          <Badge
            variant={puzzle.isAvailable ? "default" : "secondary"}
            className="text-sm"
          >
            {puzzle.isAvailable ? t("available") : t("unavailable")}
          </Badge>
          {puzzle.isCompleted && (
            <Badge variant="outline" className="text-sm">
              {t("completed")}
            </Badge>
          )}
        </div>
      </div>

      {puzzle.description && (
        <p className="text-muted-foreground">{puzzle.description}</p>
      )}
    </div>
  );
}
