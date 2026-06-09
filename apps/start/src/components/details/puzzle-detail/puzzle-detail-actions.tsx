"use client";

import { Button } from "@/components/ui/button";
import { gateway, Id } from "@/gateway";
import type { FunctionReturnType } from "convex/server";
import { Edit, Eye, Heart, MessageCircle, Trash2 } from "lucide-react";
import { useTranslations } from "use-intl";

// Owned-copy detail view DTO this component renders, derived from the read it is fed by. Its `_id`
// surfaces as an opaque string; the action callbacks take a branded Convex id, re-cast once below.
type PuzzleData = NonNullable<
  FunctionReturnType<typeof gateway.library.ownedWithCollectionStatus>
>;

interface PuzzleDetailActionsProps {
  puzzle: PuzzleData;
  onEdit?: (puzzleId: Id<"ownedPuzzles">) => void;
  onView?: (puzzleId: Id<"ownedPuzzles">) => void;
  onDelete?: (puzzleId: Id<"ownedPuzzles">) => void;
  onRequestExchange?: (puzzleId: Id<"ownedPuzzles">) => void;
  onMessage?: (puzzleId: Id<"ownedPuzzles">) => void;
  onFavorite?: (puzzleId: Id<"ownedPuzzles">) => void;
}

export function PuzzleDetailActions({
  puzzle,
  onEdit,
  onView,
  onDelete,
  onRequestExchange,
  onMessage,
  onFavorite,
}: PuzzleDetailActionsProps) {
  const t = useTranslations("puzzles");

  // DTO surfaces the copy id as a string; the callbacks take a branded Convex id.
  const ownedId = puzzle._id as Id<"ownedPuzzles">;

  return (
    <div className="space-y-4">
      {/* Primary Actions */}
      <div className="flex flex-col sm:flex-row gap-2">
        {onRequestExchange && puzzle.availability.forTrade && (
          <Button className="flex-1">{t("requestExchange")}</Button>
        )}
        {onEdit && (
          <Button variant="outline" onClick={() => onEdit(ownedId)}>
            <Edit className="h-4 w-4 mr-2" />
            Edit
          </Button>
        )}
        {onView && (
          <Button variant="outline" onClick={() => onView(ownedId)}>
            <Eye className="h-4 w-4 mr-2" />
            View
          </Button>
        )}
      </div>

      {/* Secondary Actions */}
      <div className="flex items-center gap-2">
        {onFavorite && (
          <Button
            variant="ghost"
            size="sm"
            onClick={() => onFavorite(ownedId)}
          >
            <Heart className="h-4 w-4" />
          </Button>
        )}
        {onMessage && (
          <Button
            variant="ghost"
            size="sm"
            onClick={() => onMessage(ownedId)}
          >
            <MessageCircle className="h-4 w-4" />
          </Button>
        )}
        {onDelete && (
          <Button
            variant="ghost"
            size="sm"
            onClick={() => onDelete(ownedId)}
          >
            <Trash2 className="h-4 w-4" />
          </Button>
        )}
      </div>
    </div>
  );
}
