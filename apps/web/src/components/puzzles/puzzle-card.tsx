"use client";

import { Link } from "@/compat/link";
import { Button } from "@/components/ui/button";
import { gateway } from "@/gateway";
import { useBoxArtInCheck } from "@/hooks/use-box-art-check";
import { useFavorites } from "@/hooks/use-favorites";
import { cn } from "@/lib/utils";
import type { FunctionReturnType } from "convex/server";
import { Heart, Plus } from "lucide-react";
import { useTranslations } from "use-intl";
import { PuzzleCardShell } from "./puzzle-card-shell";
import { PUZZLE_GRID_COVER_SIZES } from "./puzzle-view-provider";

// Catalog summary view DTO this card renders, derived from the recent-puzzles read it is fed by
// (the same shape `catalog.listAll` paginates). Ids surface as opaque strings.
type Puzzle = FunctionReturnType<typeof gateway.catalog.recentPuzzles>[number];

interface PuzzleCardProps {
  puzzle: Puzzle;
}

export function PuzzleCard({ puzzle }: PuzzleCardProps) {
  const t = useTranslations("puzzles");
  // Catalog-card strings (the favourite labels) live under the nested
  // `puzzles.puzzles.*` namespace, not the flat `puzzles.*` one used by `t`.
  const tCat = useTranslations("puzzles.puzzles");
  const { isFavorite, toggleFavorite } = useFavorites();
  const favorited = isFavorite(puzzle._id);
  const boxArtInCheck = useBoxArtInCheck();
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
        imageSrcSet: puzzle.imageSrcSet,
      }}
      // Every page renders these cards in the default PuzzleViewProvider grid.
      imageSizes={PUZZLE_GRID_COVER_SIZES}
      imageHref={`/puzzles/${puzzle._id}`}
      imageFit="contain"
      imageChecking={!puzzle.image && boxArtInCheck.has(puzzle._id)}
      actions={
        // The card opens the puzzle through its title's stretched link (one Tab stop per card), so
        // the row only holds the card's own actions: compact icon buttons with accessible names.
        <div className="flex items-center justify-end gap-2">
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
            aria-label={t("addToLibrary")}
            title={t("addToLibrary")}
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
