"use client";

import {
  PuzzleCardShell,
  type PuzzleCardView,
} from "@/components/puzzles/puzzle-card-shell";
// Re-export the consolidated provider so existing call sites that import
// `{ PuzzleCard, PuzzleViewProvider }` from this module keep working.
import {
  PuzzleViewProvider,
  usePuzzleView,
} from "@/components/puzzles/puzzle-view-provider";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { gateway, Id } from "@/gateway";
import type { FunctionReturnType } from "convex/server";
import {
  Check,
  CircleCheck,
  Edit,
  Eye,
  Heart,
  MessageCircle,
  Trash2,
  User,
} from "lucide-react";
import { ReactNode } from "react";
import { useTranslations } from "use-intl";
import { CollectionDropdown } from "./collection-dropdown";

export { PuzzleViewProvider, usePuzzleView };

// Owned-copy view DTO this card renders, derived from the library read it is fed by (ids surface as
// opaque strings; the card re-casts `_id` to `Id<"ownedPuzzles">` once at the callback boundary).
type OwnedPuzzleData = FunctionReturnType<
  typeof gateway.library.ownedByOwner
>[number];

interface PuzzleCardProps {
  puzzle: OwnedPuzzleData;
  variant?: "default" | "browse" | "collection" | "selection";
  onEdit?: (puzzleId: Id<"ownedPuzzles">) => void;
  onView?: (puzzleId: Id<"ownedPuzzles">) => void;
  onDelete?: (puzzleId: Id<"ownedPuzzles">) => void;
  onRemove?: (puzzleId: Id<"ownedPuzzles">) => void;
  onSelect?: (puzzleId: Id<"ownedPuzzles">) => void;
  onRequestExchange?: (puzzleId: Id<"ownedPuzzles">) => void;
  onMessage?: (puzzleId: Id<"ownedPuzzles">) => void;
  onFavorite?: (puzzleId: Id<"ownedPuzzles">) => void;
  onLogSolve?: (puzzleId: Id<"ownedPuzzles">) => void;
  isSelected?: boolean;
  showOwner?: boolean;
  showActions?: boolean;
  showAvailability?: boolean;
  showCollectionDropdown?: boolean;
  // Optional lending slot (e.g. an "on loan to X" badge + Recall action). The page owns the loan
  // data so the card stays generic; rendered above the action row when provided.
  loanBadge?: ReactNode;
  className?: string;
}

export function PuzzleCard({
  puzzle,
  variant = "default",
  onEdit,
  onView,
  onDelete,
  onRemove,
  onSelect,
  onRequestExchange,
  onMessage,
  onFavorite,
  onLogSolve,
  isSelected = false,
  showOwner = false,
  showActions = true,
  showAvailability = true,
  showCollectionDropdown = false,
  loanBadge,
  className = "",
}: PuzzleCardProps) {
  const t = useTranslations("puzzles");
  const tSolving = useTranslations("solving.logSolve");

  // Early return if no puzzle data
  if (!puzzle.puzzle) {
    return null;
  }

  // DTO surfaces the copy id as a string; callbacks/CollectionDropdown take a branded Convex id.
  const ownedId = puzzle._id as Id<"ownedPuzzles">;

  const view: PuzzleCardView = {
    id: puzzle._id,
    title: puzzle.puzzle.title || "Unknown Puzzle",
    brand: puzzle.puzzle.brand,
    pieceCount: puzzle.puzzle.pieceCount,
    difficulty: puzzle.puzzle.difficulty,
    description: puzzle.puzzle.description,
    tags: puzzle.puzzle.tags,
    // Prefer the resolved cover (chosen-and-approved cover photo, else the catalogue box art) so a
    // copy's custom cover shows on its card instead of the placeholder; falls back to legacy images.
    imageUrl: puzzle.coverUrl ?? puzzle.puzzle.images?.[0],
  };

  // Context badges: condition, availability flags, and the owner — the
  // owned-copy specifics that the shared shell deliberately doesn't know about.
  const badges = (
    <>
      <div className="flex flex-wrap items-center gap-2 mb-2">
        <Badge
          variant={
            puzzle.condition === "new_sealed" || puzzle.condition === "like_new"
              ? "default"
              : "secondary"
          }
          className="text-xs"
        >
          {t(puzzle.condition)}
        </Badge>
      </div>

      {showAvailability && (
        <div className="flex items-center gap-2 mb-2">
          {puzzle.availability.forLend ? (
            <Badge variant="outline" className="text-xs">
              {t("lend")}
            </Badge>
          ) : null}
          {puzzle.availability.forTrade ? (
            <Badge variant="outline" className="text-xs">
              {t("trade")}
            </Badge>
          ) : null}
          {puzzle.availability.forSale ? (
            <Badge variant="outline" className="text-xs">
              {t("sale")}
            </Badge>
          ) : null}
        </div>
      )}

      {showOwner && puzzle.owner && (
        <div className="flex items-center gap-2 mb-2">
          <User className="h-3 w-3 text-muted-foreground" />
          <span className="text-xs text-muted-foreground">
            {puzzle.owner.name}
          </span>
        </div>
      )}
    </>
  );

  // Image overlays: the selection ring's check, and the selection-variant checkbox.
  const overlay = (
    <>
      {isSelected && (
        <div className="absolute inset-0 bg-primary/20 flex items-center justify-center">
          <Check className="h-8 w-8 text-primary" />
        </div>
      )}
      {variant === "selection" && (
        <div className="absolute top-2 right-2">
          <input
            type="checkbox"
            checked={isSelected}
            onChange={() => onSelect?.(ownedId)}
            className="h-4 w-4"
          />
        </div>
      )}
    </>
  );

  const actions =
    showActions || showCollectionDropdown ? (
      <div className="flex items-center justify-between gap-2">
        {showActions ? (
          <div className="flex items-center gap-2">
            {onView && (
              <Button
                variant="ghost"
                size="sm"
                onClick={() => onView(ownedId)}
                className="h-8 w-8 p-0"
              >
                <Eye className="h-4 w-4" />
              </Button>
            )}
            {onLogSolve && (
              <Button
                variant="ghost"
                size="sm"
                onClick={() => onLogSolve(ownedId)}
                className="h-8 w-8 p-0"
                title={tSolving("trigger")}
                aria-label={tSolving("trigger")}
              >
                <CircleCheck className="h-4 w-4" />
              </Button>
            )}
            {onEdit && (
              <Button
                variant="ghost"
                size="sm"
                onClick={() => onEdit(ownedId)}
                className="h-8 w-8 p-0"
              >
                <Edit className="h-4 w-4" />
              </Button>
            )}
            {onDelete && (
              <Button
                variant="ghost"
                size="sm"
                onClick={() => onDelete(ownedId)}
                className="h-8 w-8 p-0 text-destructive hover:text-destructive"
              >
                <Trash2 className="h-4 w-4" />
              </Button>
            )}
            {onRemove && (
              <Button
                variant="ghost"
                size="sm"
                onClick={() => onRemove(ownedId)}
                className="h-8 w-8 p-0 text-destructive hover:text-destructive"
              >
                <Trash2 className="h-4 w-4" />
              </Button>
            )}
            {onRequestExchange && (
              <Button
                variant="ghost"
                size="sm"
                onClick={() => onRequestExchange(ownedId)}
                className="h-8 w-8 p-0"
              >
                <MessageCircle className="h-4 w-4" />
              </Button>
            )}
            {onMessage && (
              <Button
                variant="ghost"
                size="sm"
                onClick={() => onMessage(ownedId)}
                className="h-8 w-8 p-0"
              >
                <MessageCircle className="h-4 w-4" />
              </Button>
            )}
            {onFavorite && (
              <Button
                variant="ghost"
                size="sm"
                onClick={() => onFavorite(ownedId)}
                className="h-8 w-8 p-0"
              >
                <Heart className="h-4 w-4" />
              </Button>
            )}
          </div>
        ) : (
          <span />
        )}
        {showCollectionDropdown && (
          <CollectionDropdown
            ownedPuzzleId={ownedId}
            copyAggregateId={puzzle.aggregateId}
          />
        )}
      </div>
    ) : undefined;

  return (
    <PuzzleCardShell
      puzzle={view}
      selected={isSelected}
      badges={badges}
      overlay={overlay}
      footer={loanBadge}
      actions={actions}
      className={className}
    />
  );
}
