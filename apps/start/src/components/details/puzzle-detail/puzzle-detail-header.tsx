"use client";

import { Badge } from "@/components/ui/badge";
import { gateway } from "@/gateway";
import type { FunctionReturnType } from "convex/server";
import { useTranslations } from "use-intl";

// Owned-copy detail view DTO this header renders, derived from the read it is fed by.
type OwnedPuzzleData = NonNullable<
  FunctionReturnType<typeof gateway.library.ownedWithCollectionStatus>
>;

interface PuzzleDetailHeaderProps {
  puzzle: OwnedPuzzleData;
}

export function PuzzleDetailHeader({ puzzle }: PuzzleDetailHeaderProps) {
  const t = useTranslations("puzzles");

  // Early return if no puzzle data
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
