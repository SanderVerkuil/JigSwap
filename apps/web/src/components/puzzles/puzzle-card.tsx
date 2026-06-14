"use client";

import { Link } from "@/compat/link";
import { Button } from "@/components/ui/button";
import { gateway } from "@/gateway";
import type { FunctionReturnType } from "convex/server";
import { Eye, Plus } from "lucide-react";
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
      actions={
        <div className="flex gap-2 mt-auto">
          <Button variant="outline" size="sm" asChild className="flex-1">
            <Link href={`/puzzles/${puzzle._id}`}>
              <Eye className="h-4 w-4 mr-2" />
              {tCat("viewDetails")}
            </Link>
          </Button>
          <Button size="sm" asChild className="flex-1">
            <Link href={`/my-puzzles/add/new?puzzleId=${puzzle._id}`}>
              <Plus className="h-4 w-4 mr-2" />
              {t("addPuzzle")}
            </Link>
          </Button>
        </div>
      }
    />
  );
}
