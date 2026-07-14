"use client";

import { Link } from "@/compat/link";
import { Button } from "@/components/ui/button";
import { gateway } from "@/gateway";
import { useFavorites } from "@/hooks/use-favorites";
import { cn } from "@/lib/utils";
import type { FunctionReturnType } from "convex/server";
import { Eye, Heart, Plus } from "lucide-react";
import { useTranslations } from "use-intl";
import { PuzzleCardShell } from "./puzzle-card-shell";

// Catalog summary view DTO this card renders, derived from the recent-puzzles read it is fed by
// (the same shape `catalog.listAll` paginates). Ids surface as opaque strings.
type Puzzle = FunctionReturnType<typeof gateway.catalog.recentPuzzles>[number];

interface PuzzleCardProps {
  puzzle: Puzzle;
}

export function PuzzleCard({ puzzle }: PuzzleCardProps) {
  const t = useTranslations("puzzles");
  // Catalog-card strings ("view details") live under the nested
  // `puzzles.puzzles.*` namespace, not the flat `puzzles.*` one used by `t`.
  const tCat = useTranslations("puzzles.puzzles");
  const { isFavorite, toggleFavorite } = useFavorites();
  const favorited = isFavorite(puzzle._id);
  const favoriteLabel = favorited
    ? tCat("removeFromFavorites")
    : tCat("addToFavorites");

  return (
    <PuzzleCardShell
      puzzle={{
        id: puzzle._id,
        title: puzzle.title,
        brand: puzzle.brand,
        pieceCount: puzzle.pieceCount,
        difficulty: puzzle.difficulty,
        description: puzzle.description,
        tags: puzzle.tags,
        imageUrl: puzzle.image,
      }}
      imageHref={`/puzzles/${puzzle._id}`}
      imageFit="contain"
      actions={
        // The grid columns are ~212px wide, so the row must fit two buttons
        // without overflowing the card (which is `overflow-hidden`). The primary
        // "view details" takes the remaining width and truncates if needed; the
        // add action is a compact icon-only button with an accessible label.
        <div className="flex items-center gap-2">
          <Button
            variant="outline"
            size="sm"
            asChild
            className="min-w-0 flex-1"
          >
            <Link href={`/puzzles/${puzzle._id}`}>
              <Eye className="h-4 w-4 shrink-0" />
              <span className="truncate">{tCat("viewDetails")}</span>
            </Link>
          </Button>
          <Button
            variant="outline"
            size="icon"
            aria-label={favoriteLabel}
            aria-pressed={favorited}
            title={favoriteLabel}
            className="shrink-0"
            onClick={() => void toggleFavorite(puzzle._id)}
          >
            <Heart
              className={cn(
                "h-4 w-4",
                favorited && "fill-red-500 text-red-500",
              )}
            />
          </Button>
          <Button
            size="icon"
            asChild
            aria-label={t("addPuzzle")}
            title={t("addPuzzle")}
            className="shrink-0"
          >
            <Link href={`/my-puzzles/add/new?puzzleId=${puzzle._id}`}>
              <Plus className="h-4 w-4" />
            </Link>
          </Button>
        </div>
      }
    />
  );
}
