"use client";

import { Link } from "@/compat/link";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { gateway } from "@/gateway";
import { useBoxArtInCheck } from "@/hooks/use-box-art-check";
import { useFavorites } from "@/hooks/use-favorites";
import { cn } from "@/lib/utils";
import type { FunctionReturnType } from "convex/server";
import { Check, Heart, Plus } from "lucide-react";
import { useTranslations } from "use-intl";
import {
  PuzzleCardShell,
  type PuzzleCardShellProps,
} from "./puzzle-card-shell";
import { PUZZLE_GRID_COVER_SIZES } from "./puzzle-view-provider";

// Catalog summary view DTO this card renders, derived from the recent-puzzles read it is fed by
// (the same shape `catalog.listAll` paginates). Ids surface as opaque strings.
type Puzzle = FunctionReturnType<typeof gateway.catalog.recentPuzzles>[number];

interface PuzzleCardProps {
  puzzle: Puzzle;
  /**
   * "catalogue" (default): the card opens the catalogue page, with a heart and a + to add a copy.
   * "pick": the Add Puzzle chooser's card. The whole card opens the add-a-copy form, with a
   * labelled "Add to Library" button and a small Details link; no heart.
   */
  variant?: "catalogue" | "pick";
  /** The member already owns a copy of this puzzle ("On your shelf"). */
  onShelf?: boolean;
  /** Card title heading level; 2 when the grid sits directly under the page h1. */
  headingLevel?: PuzzleCardShellProps["headingLevel"];
}

// The add-a-copy form for a catalogue puzzle.
export const addCopyHref = (puzzleId: string) =>
  `/my-puzzles/add/new?puzzleId=${puzzleId}`;

export function PuzzleCard({
  puzzle,
  variant = "catalogue",
  onShelf = false,
  headingLevel,
}: PuzzleCardProps) {
  return variant === "pick" ? (
    <PickPuzzleCard
      puzzle={puzzle}
      onShelf={onShelf}
      headingLevel={headingLevel}
    />
  ) : (
    <CataloguePuzzleCard
      puzzle={puzzle}
      onShelf={onShelf}
      headingLevel={headingLevel}
    />
  );
}

// "On your shelf": the same marker on the catalogue's cards and the chooser's.
function OnShelfBadge() {
  const t = useTranslations("cataloguePicker");
  return (
    <Badge variant="outline">
      <Check aria-hidden />
      {t("onShelf")}
    </Badge>
  );
}

function CataloguePuzzleCard({
  puzzle,
  onShelf,
  headingLevel,
}: Pick<PuzzleCardProps, "puzzle" | "headingLevel"> & { onShelf: boolean }) {
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
      headingLevel={headingLevel}
      imageChecking={!puzzle.image && boxArtInCheck.has(puzzle._id)}
      badges={
        onShelf ? (
          <div className="mb-2">
            <OnShelfBadge />
          </div>
        ) : undefined
      }
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

// The chooser's card: picking a puzzle is the point, so the card itself, and its one labelled
// button, open the add-a-copy form. The catalogue page stays one small Details link away.
function PickPuzzleCard({
  puzzle,
  onShelf,
  headingLevel,
}: Pick<PuzzleCardProps, "puzzle" | "headingLevel"> & { onShelf: boolean }) {
  const t = useTranslations("puzzles");
  const boxArtInCheck = useBoxArtInCheck();
  const addHref = addCopyHref(puzzle._id);

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
      // The chooser's auto-fill grid has the default grid's column bounds (PuzzlePickList).
      imageSizes={PUZZLE_GRID_COVER_SIZES}
      headingLevel={headingLevel}
      imageHref={addHref}
      imageFit="contain"
      imageChecking={!puzzle.image && boxArtInCheck.has(puzzle._id)}
      badges={
        onShelf ? (
          <div className="mb-2">
            <OnShelfBadge />
          </div>
        ) : undefined
      }
      actions={
        // Wraps instead of truncating: on a narrow card (or with a long Dutch label) Details drops
        // to its own line, and the Add label may still wrap inside its button, so neither is cut.
        <div className="flex flex-wrap items-center justify-center gap-x-2 gap-y-1">
          {/* Already on the shelf: still possible, but no longer the obvious next step. */}
          <Button
            size="sm"
            variant={onShelf ? "outline" : "default"}
            asChild
            className="h-auto min-h-8 min-w-0 flex-auto py-1.5 whitespace-normal"
          >
            <Link href={addHref}>
              <Plus aria-hidden className="h-4 w-4" />
              {onShelf ? t("chooser.addAnotherCopy") : t("addToLibrary")}
            </Link>
          </Button>
          <Button
            variant="ghost"
            size="sm"
            asChild
            className="text-muted-foreground shrink-0"
          >
            <Link
              href={`/puzzles/${puzzle._id}`}
              aria-label={t("chooser.detailsOf", { title: puzzle.title })}
            >
              {t("chooser.details")}
            </Link>
          </Button>
        </div>
      }
    />
  );
}
