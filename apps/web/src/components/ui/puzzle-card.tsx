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
import { CollectionMenuItems } from "@/components/ui/collection-dropdown";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuSub,
  DropdownMenuSubContent,
  DropdownMenuSubTrigger,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { gateway, Id } from "@/gateway";
import type { FunctionReturnType } from "convex/server";
import {
  Check,
  CircleCheck,
  Edit,
  FolderOpen,
  Heart,
  MessageCircle,
  MoreHorizontal,
  Trash2,
  User,
} from "lucide-react";
import { ReactNode } from "react";
import { useTranslations } from "use-intl";

export { PuzzleViewProvider, usePuzzleView };

// Owned-copy view DTO this card renders, derived from the library read it is fed by (ids surface as
// opaque strings; the card re-casts `_id` to `Id<"ownedPuzzles">` once at the callback boundary).
type OwnedPuzzleData = FunctionReturnType<
  typeof gateway.library.ownedByOwner
>[number];

interface PuzzleCardProps {
  puzzle: OwnedPuzzleData;
  // "pick" = single-pick picker: the whole card is clickable (fires onSelect) but renders no
  // multi-select checkbox or selection ring, so it doesn't read as a bulk action.
  variant?: "default" | "browse" | "collection" | "selection" | "pick";
  onEdit?: (puzzleId: Id<"ownedPuzzles">) => void;
  onView?: (puzzleId: Id<"ownedPuzzles">) => void;
  /**
   * Base path the cover image links to (so it matches the Eye/view action):
   * `${viewBasePath}/${ownedId}`. Defaults to "/copies"; My Puzzles passes
   * "/my-puzzles" so the owner sees their own gated copy route.
   */
  viewBasePath?: string;
  /** Appended verbatim to the view link (e.g. `?from=collection:<id>`) for contextual breadcrumbs. */
  viewSearch?: string;
  /** Cover image fit: "cover" crops (default), "contain" shows the full image. */
  imageFit?: "cover" | "contain";
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

// ---------------------------------------------------------------------------
// Persistent top-right "⋯" overflow menu chip (owner-management actions).
// Rendered as a cover overlay so it sits above the stretched-link (z-10) and
// is always mounted for keyboard/SR reachability. Suppressed in selection/pick.
// ---------------------------------------------------------------------------
// Shared top-right "corner chip" styling for the card's overlay controls (the ⋯ menu and the
// collection remove button): frosted glass, always mounted, dimmed at rest on hover-capable
// devices, full on card-hover/focus/touch. 44px hit area via negative margin + padding.
const CORNER_CHIP_CLASS = [
  "flex h-[40px] w-[40px] items-center justify-center rounded-full",
  "bg-background/70 backdrop-blur-md border border-border/50 shadow-sm",
  "-m-[2px] p-[2px]",
  "motion-safe:transition-opacity motion-safe:duration-150",
  "[@media(hover:hover)_and_(pointer:fine)]:opacity-60",
  "group-hover:opacity-100 focus-within:opacity-100",
].join(" ");

interface PuzzleOverflowMenuProps {
  ownedId: Id<"ownedPuzzles">;
  onLogSolve?: (id: Id<"ownedPuzzles">) => void;
  onEdit?: (id: Id<"ownedPuzzles">) => void;
  onDelete?: (id: Id<"ownedPuzzles">) => void;
  // When set, the menu includes an "add to collection" submenu (the Copy aggregateId the add needs).
  showCollection?: boolean;
  copyAggregateId?: string;
}

function PuzzleOverflowMenu({
  ownedId,
  onLogSolve,
  onEdit,
  onDelete,
  showCollection = false,
  copyAggregateId,
}: PuzzleOverflowMenuProps) {
  const t = useTranslations("puzzles");
  const tSolving = useTranslations("solving.logSolve");

  // Don't mount the chip at all when nothing is wired.
  if (!onLogSolve && !onEdit && !onDelete && !showCollection) return null;

  return (
    // `relative z-10` wrapper sits above the stretched-link overlay (z-[1]).
    // The 44px touch target is achieved via negative margin + extra padding.
    <div className="absolute top-2 right-2 z-10">
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <button
            type="button"
            aria-label={t("overflowMenu.ariaLabel")}
            onClick={(e) => e.stopPropagation()}
            // `data-[state=open]` pins opacity + a subtle bg while the menu is open.
            className={`${CORNER_CHIP_CLASS} text-foreground data-[state=open]:opacity-100 data-[state=open]:bg-accent`}
          >
            <MoreHorizontal className="h-4 w-4" aria-hidden />
          </button>
        </DropdownMenuTrigger>
        {/* Portal ensures the menu content is portaled out of the card's
            stacking context so clicks can't fall through to the stretched link. */}
        <DropdownMenuContent align="end" className="min-w-[160px]">
          {onLogSolve && (
            <DropdownMenuItem
              onClick={(e) => {
                e.stopPropagation();
                onLogSolve(ownedId);
              }}
            >
              <CircleCheck className="h-4 w-4 mr-2 shrink-0" />
              {tSolving("trigger")}
            </DropdownMenuItem>
          )}
          {onEdit && (
            <DropdownMenuItem
              onClick={(e) => {
                e.stopPropagation();
                onEdit(ownedId);
              }}
            >
              <Edit className="h-4 w-4 mr-2 shrink-0" />
              {t("overflowMenu.edit")}
            </DropdownMenuItem>
          )}
          {showCollection && (
            <DropdownMenuSub>
              <DropdownMenuSubTrigger onClick={(e) => e.stopPropagation()}>
                <FolderOpen className="h-4 w-4 mr-2 shrink-0" />
                {t("overflowMenu.collection")}
              </DropdownMenuSubTrigger>
              <DropdownMenuSubContent>
                <CollectionMenuItems
                  ownedPuzzleId={ownedId}
                  copyAggregateId={copyAggregateId}
                />
              </DropdownMenuSubContent>
            </DropdownMenuSub>
          )}
          {onDelete && (
            <>
              <DropdownMenuSeparator />
              <DropdownMenuItem
                onClick={(e) => {
                  e.stopPropagation();
                  onDelete(ownedId);
                }}
                className="text-destructive focus:text-destructive"
              >
                <Trash2 className="h-4 w-4 mr-2 shrink-0" />
                {t("overflowMenu.delete")}
              </DropdownMenuItem>
            </>
          )}
        </DropdownMenuContent>
      </DropdownMenu>
    </div>
  );
}

// Collection cards use the top-right corner (where owner cards show the ⋯ menu) for a single
// "remove from this collection" action, with a tooltip clarifying what it does.
function PuzzleCornerRemove({
  ownedId,
  onRemove,
}: {
  ownedId: Id<"ownedPuzzles">;
  onRemove: (id: Id<"ownedPuzzles">) => void;
}) {
  const t = useTranslations("puzzles");
  return (
    <div className="absolute top-2 right-2 z-10">
      <TooltipProvider>
        <Tooltip>
          <TooltipTrigger asChild>
            <button
              type="button"
              aria-label={t("removeFromCollection")}
              onClick={(e) => {
                e.stopPropagation();
                onRemove(ownedId);
              }}
              className={`${CORNER_CHIP_CLASS} text-destructive hover:bg-destructive/10`}
            >
              <Trash2 className="h-4 w-4" aria-hidden />
            </button>
          </TooltipTrigger>
          <TooltipContent>{t("removeFromCollection")}</TooltipContent>
        </Tooltip>
      </TooltipProvider>
    </div>
  );
}

export function PuzzleCard({
  puzzle,
  variant = "default",
  onEdit,
  onView: _onView,
  viewBasePath = "/copies",
  viewSearch,
  imageFit,
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

  // Whether this variant should show the ⋯ overflow menu (owner-management actions).
  // Suppressed in selection/pick where card-click owns the interaction.
  const showOverflowMenu =
    showActions &&
    variant !== "selection" &&
    variant !== "pick" &&
    !!(onLogSolve || onEdit || onDelete || showCollectionDropdown);

  // Image overlays: the ⋯ overflow chip (top-right), the selection ring's
  // check, and the selection-variant checkbox.
  const overlay = (
    <>
      {showOverflowMenu && (
        <PuzzleOverflowMenu
          ownedId={ownedId}
          onLogSolve={onLogSolve}
          onEdit={onEdit}
          onDelete={onDelete}
          showCollection={showCollectionDropdown}
          copyAggregateId={puzzle.aggregateId}
        />
      )}
      {showActions && variant === "collection" && onRemove && (
        <PuzzleCornerRemove ownedId={ownedId} onRemove={onRemove} />
      )}
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
            // The whole card already toggles selection; stop the click here from
            // bubbling to the card so the toggle doesn't fire twice and cancel out.
            onClick={(e) => e.stopPropagation()}
            className="h-4 w-4"
          />
        </div>
      )}
    </>
  );

  // Browse/exchange/social actions stay in the bottom action row as before.
  // The owner-management actions (log solve, edit, delete) AND "add to collection" now live in
  // the ⋯ overflow menu (the latter as a submenu), so they no longer render a bottom-row control.
  // The collection variant's onRemove moves to the top-right corner chip (PuzzleCornerRemove).
  // onView is intentionally omitted here: whole-card navigation covers it (stretched link).
  const browseActions = !!(
    (variant !== "collection" && onRemove) ||
    onRequestExchange ||
    onMessage ||
    onFavorite
  );
  const hasBrowseRow = showActions && browseActions;

  const actions = hasBrowseRow ? (
    <div className="flex items-center justify-between gap-2">
      <div className="flex items-center gap-2">
        {variant !== "collection" && onRemove && (
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
    </div>
  ) : undefined;

  return (
    <PuzzleCardShell
      puzzle={view}
      selected={isSelected}
      // In the selection picker the whole card toggles selection (not just the
      // checkbox); the checkbox stays as the visible state + keyboard target. The
      // "pick" variant is also card-clickable but shows no checkbox (single pick).
      selectable={(variant === "selection" || variant === "pick") && !!onSelect}
      onSelect={onSelect ? () => onSelect(ownedId) : undefined}
      badges={badges}
      overlay={overlay}
      footer={loanBadge}
      actions={actions}
      // The cover link navigates to the puzzle's view page. With the overflow
      // menu in place, `onView` no longer drives a bottom button — but the
      // stretched link (via imageHref) still handles whole-card navigation.
      // NOT in the selection/pick variants: there the whole card click is the
      // selection action, so a navigating cover link would hijack it.
      imageHref={
        variant !== "selection" && variant !== "pick" && viewBasePath && ownedId
          ? `${viewBasePath}/${ownedId}${viewSearch ?? ""}`
          : undefined
      }
      imageFit={imageFit}
      className={className}
    />
  );
}
