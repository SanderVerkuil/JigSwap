"use client";

import {
  conditionDotClass,
  useConditionLabel,
} from "@/components/library/condition";
import {
  PuzzleCardShell,
  type PuzzleCardView,
} from "@/components/puzzles/puzzle-card-shell";
// Re-export the consolidated provider so existing call sites that import
// `{ PuzzleCard, PuzzleViewProvider }` from this module keep working.
import {
  PUZZLE_GRID_COVER_SIZES,
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
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { gateway, Id } from "@/gateway";
import { useBoxArtInCheck } from "@/hooks/use-box-art-check";
import { cn } from "@/lib/utils";
import type { FunctionReturnType } from "convex/server";
import {
  ArrowLeftRight,
  Check,
  CircleCheck,
  Clock,
  Edit,
  FolderMinus,
  FolderOpen,
  Heart,
  Lock,
  MessageCircle,
  MoreHorizontal,
  Package,
  Play,
  Tag,
  Trash2,
  User,
  Users,
  type LucideIcon,
} from "lucide-react";
import { ReactNode, useRef, type RefObject } from "react";
import { useTranslations } from "use-intl";

export { PuzzleViewProvider, usePuzzleView };

// Owned-copy view DTO this card renders, derived from the library read it is fed by (ids surface as
// opaque strings; the card re-casts `_id` to `Id<"ownedPuzzles">` once at the callback boundary).
// The owner is left out: Browse's owner is privacy-projected, so the caller resolves the label
// (`ownerLabel`) and the card never needs the owner's id or identity.
type OwnedPuzzleData = Omit<
  FunctionReturnType<typeof gateway.library.ownedByOwner>[number],
  "owner" | "ownerId"
>;

interface PuzzleCardProps {
  puzzle: OwnedPuzzleData;
  variant?: "default" | "browse" | "collection" | "selection";
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
  /** The cover's `sizes` in grid view (see PuzzleCardShell's imageSizes); defaults to the
   *  PuzzleViewProvider grid's PUZZLE_GRID_COVER_SIZES. */
  imageSizes?: string;
  onDelete?: (puzzleId: Id<"ownedPuzzles">) => void;
  onRemove?: (puzzleId: Id<"ownedPuzzles">) => void;
  onSelect?: (puzzleId: Id<"ownedPuzzles">) => void;
  onRequestExchange?: (puzzleId: Id<"ownedPuzzles">) => void;
  onMessage?: (puzzleId: Id<"ownedPuzzles">) => void;
  /** Toggles the catalogue favourite of this copy's puzzle; `favorited` is its current state. */
  onFavorite?: (puzzleId: Id<"ownedPuzzles">) => void;
  favorited?: boolean;
  onLogSolve?: (puzzleId: Id<"ownedPuzzles">) => void;
  // Start/Finish solve swap: the page resolves whether the caller has an in-progress solve on
  // this copy (`solveInProgress`) and handles the action (start vs finish) itself.
  onStartSolve?: (puzzleId: Id<"ownedPuzzles">) => void;
  solveInProgress?: boolean;
  // The owner's "Share with circles…" (the page owns the dialog). `opener` is the ⋯ trigger, for
  // the dialog to hand focus back to.
  onShareWithCircles?: (
    puzzleId: Id<"ownedPuzzles">,
    opener: RefObject<HTMLElement | null>,
  ) => void;
  isSelected?: boolean;
  /** The owner's already-resolved label (e.g. "Deleted member" for a departed owner); shown when set. */
  ownerLabel?: string;
  showActions?: boolean;
  showAvailability?: boolean;
  showCollectionDropdown?: boolean;
  /** Optional owner line (whose copy this is, e.g. a household member's), first in the content. */
  owner?: ReactNode;
  // Optional lending slot (e.g. an "on loan to X" badge + Recall action). The page owns the loan
  // data so the card stays generic; rendered above the action row when provided.
  loanBadge?: ReactNode;
  className?: string;
}

// What a copy is offered for, each with its own icon, in the card's offer chips.
const OFFERS: ReadonlyArray<{
  flag: "forTrade" | "forLend" | "forSale";
  label: "trade" | "lend" | "sale";
  Icon: LucideIcon;
}> = [
  { flag: "forTrade", label: "trade", Icon: ArrowLeftRight },
  { flag: "forLend", label: "lend", Icon: Package },
  { flag: "forSale", label: "sale", Icon: Tag },
];

// ---------------------------------------------------------------------------
// Persistent top-right "⋯" overflow menu chip (owner-management actions).
// Rendered as a cover overlay so it sits above the stretched-link (z-10) and
// is always mounted for keyboard/SR reachability. Suppressed in selection.
// ---------------------------------------------------------------------------
// Top-right "corner chip" styling for the card's ⋯ menu trigger: frosted glass, always mounted,
// dimmed at rest on hover-capable devices, full on card-hover/focus/touch. 44px hit area via
// negative margin + padding.
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
  onStartSolve?: (id: Id<"ownedPuzzles">) => void;
  solveInProgress?: boolean;
  onEdit?: (id: Id<"ownedPuzzles">) => void;
  onShareWithCircles?: (
    id: Id<"ownedPuzzles">,
    opener: RefObject<HTMLElement | null>,
  ) => void;
  onDelete?: (id: Id<"ownedPuzzles">) => void;
  // When set, the menu includes an "add to collection" submenu (the Copy aggregateId the add needs).
  showCollection?: boolean;
  copyAggregateId?: string;
  // On a collection's page: take this copy out of the collection (the copy itself stays).
  onRemoveFromCollection?: (id: Id<"ownedPuzzles">) => void;
}

function PuzzleOverflowMenu({
  ownedId,
  onLogSolve,
  onStartSolve,
  solveInProgress = false,
  onEdit,
  onShareWithCircles,
  onDelete,
  showCollection = false,
  copyAggregateId,
  onRemoveFromCollection,
}: PuzzleOverflowMenuProps) {
  const t = useTranslations("puzzles");
  const tSolving = useTranslations("solving.logSolve");
  const tStart = useTranslations("solving.startSolve");
  const tCircles = useTranslations("circles");
  const triggerRef = useRef<HTMLButtonElement>(null);

  // Don't mount the chip at all when nothing is wired.
  if (
    !onLogSolve &&
    !onStartSolve &&
    !onEdit &&
    !onShareWithCircles &&
    !onDelete &&
    !showCollection &&
    !onRemoveFromCollection
  )
    return null;

  return (
    // `relative z-10` wrapper sits above the stretched-link overlay (z-[1]).
    // The 44px touch target is achieved via negative margin + extra padding.
    <div className="absolute top-2 right-2 z-10">
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <button
            ref={triggerRef}
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
          {onLogSolve && !solveInProgress && (
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
          {onStartSolve && (
            <DropdownMenuItem
              onClick={(e) => {
                e.stopPropagation();
                onStartSolve(ownedId);
              }}
            >
              {solveInProgress ? (
                <CircleCheck className="h-4 w-4 mr-2 shrink-0" />
              ) : (
                <Play className="h-4 w-4 mr-2 shrink-0" />
              )}
              {solveInProgress ? tStart("finishTrigger") : tStart("trigger")}
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
          {onShareWithCircles && (
            <DropdownMenuItem
              onClick={(e) => {
                e.stopPropagation();
                onShareWithCircles(ownedId, triggerRef);
              }}
            >
              <Users className="h-4 w-4 mr-2 shrink-0" />
              {tCircles("shareDialog.trigger")}
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
          {onRemoveFromCollection && (
            <DropdownMenuItem
              onClick={(e) => {
                e.stopPropagation();
                onRemoveFromCollection(ownedId);
              }}
            >
              <FolderMinus className="h-4 w-4 mr-2 shrink-0" />
              {t("removeFromCollection")}
            </DropdownMenuItem>
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

export function PuzzleCard({
  puzzle,
  variant = "default",
  onEdit,
  onView: _onView,
  viewBasePath = "/copies",
  viewSearch,
  imageFit,
  imageSizes = PUZZLE_GRID_COVER_SIZES,
  onDelete,
  onRemove,
  onSelect,
  onRequestExchange,
  onMessage,
  onFavorite,
  favorited = false,
  onLogSolve,
  onStartSolve,
  solveInProgress = false,
  onShareWithCircles,
  isSelected = false,
  ownerLabel,
  showActions = true,
  showAvailability = true,
  showCollectionDropdown = false,
  owner,
  loanBadge,
  className = "",
}: PuzzleCardProps) {
  const t = useTranslations("puzzles");
  const tCompletions = useTranslations("solving.completions");
  const tCard = useTranslations("browse.card");
  const tCatalog = useTranslations("puzzles.puzzles");
  const conditionLabel = useConditionLabel();
  const boxArtInCheck = useBoxArtInCheck();
  const { viewMode } = usePuzzleView();

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
    // The cover's renditions, when the read offers them (only alongside coverUrl).
    imageSrcSet: puzzle.coverSrcSet,
  };
  const imageChecking = !view.imageUrl && boxArtInCheck.has(puzzle.puzzleId);

  const offers = OFFERS.filter(({ flag }) => puzzle.availability[flag]);

  // Context badges: condition, availability flags, and the owner — the
  // owned-copy specifics that the shared shell deliberately doesn't know about.
  // Each kind of fact has its own look: condition is a coloured dot and its word, offers are
  // tinted chips with an icon, and the shell shows tags as plain "#tag" text.
  const conditionRow = (
    <div className="flex flex-wrap items-center gap-2 mb-2">
      <span
        data-testid="copy-condition"
        className="inline-flex items-center gap-1.5 text-xs font-medium text-foreground"
      >
        <span
          aria-hidden
          className={cn(
            "size-2 shrink-0 rounded-sm",
            conditionDotClass(puzzle.condition),
          )}
        />
        <span className="sr-only">{t("condition")}: </span>
        {conditionLabel(puzzle.condition)}
      </span>
      {/* Only the owner and their household ever receive a private copy. */}
      {puzzle.visibility === "private" ? (
        <Badge variant="outline" className="gap-1 text-xs">
          <Lock className="size-3" aria-hidden />
          {t("private")}
        </Badge>
      ) : null}
    </div>
  );

  const availabilityRow = showAvailability && offers.length > 0 && (
    // Wraps: all three offers do not fit one row of a compact phone card.
    <div
      data-testid="copy-offers"
      className="flex flex-wrap items-center gap-1.5 mb-2"
    >
      {offers.map(({ flag, label, Icon }) => (
        <span
          key={flag}
          className="inline-flex items-center gap-1 rounded-full border border-jigsaw-secondary/40 bg-jigsaw-secondary-tint px-2 py-0.5 text-xs font-medium text-green-800 dark:text-green-300"
        >
          <Icon className="size-3 shrink-0" aria-hidden />
          {t(label)}
        </span>
      ))}
    </div>
  );

  const ownerRow = ownerLabel && (
    <div className="flex items-center gap-2 mb-2">
      <User className="h-3 w-3 text-muted-foreground" />
      <span className="text-xs text-muted-foreground">{ownerLabel}</span>
    </div>
  );

  // On Browse a card is an offer, so whose copy it is and how it is offered (swap, lend, sell)
  // come first; the condition follows. Elsewhere the copy's own state leads.
  const badges =
    variant === "browse" ? (
      <>
        {owner}
        {ownerRow}
        {availabilityRow}
        {conditionRow}
      </>
    ) : (
      <>
        {owner}
        {conditionRow}
        {availabilityRow}
        {ownerRow}
      </>
    );

  // On a collection's page, onRemove takes the copy out of that collection: a ⋯ menu item, not
  // a one-tap control (the page passes it only to the collection's owner).
  const onRemoveFromCollection =
    variant === "collection" ? onRemove : undefined;

  // Whether this variant should show the ⋯ overflow menu (owner-management actions).
  // Suppressed in selection where card-click owns the interaction.
  const showOverflowMenu =
    showActions &&
    variant !== "selection" &&
    !!(
      onLogSolve ||
      onStartSolve ||
      onEdit ||
      onShareWithCircles ||
      onDelete ||
      showCollectionDropdown ||
      onRemoveFromCollection
    );

  // Image overlays: the ⋯ overflow chip (top-right), the selection ring's
  // check, and the selection-variant checkbox.
  const overlay = (
    <>
      {solveInProgress && (
        <div className="absolute top-2 left-2 z-10">
          <Badge
            variant="secondary"
            className="bg-background/70 backdrop-blur-md border border-border/50 shadow-sm text-xs"
          >
            <Clock className="mr-1 h-3 w-3" />
            {tCompletions("inProgress")}
          </Badge>
        </div>
      )}
      {showOverflowMenu && (
        <PuzzleOverflowMenu
          ownedId={ownedId}
          onLogSolve={onLogSolve}
          onStartSolve={onStartSolve}
          solveInProgress={solveInProgress}
          onEdit={onEdit}
          onShareWithCircles={onShareWithCircles}
          onDelete={onDelete}
          showCollection={showCollectionDropdown}
          copyAggregateId={puzzle.aggregateId}
          onRemoveFromCollection={onRemoveFromCollection}
        />
      )}
      {isSelected && (
        <div className="absolute inset-0 bg-primary/20 flex items-center justify-center">
          <Check className="h-8 w-8 text-primary-text" />
        </div>
      )}
      {variant === "selection" && (
        <div className="absolute top-2 right-2">
          <input
            type="checkbox"
            checked={isSelected}
            // Named after the puzzle; disabled when the page gives this copy no way to select it
            // (e.g. a housemate's view-only copy in My Puzzles' selection mode).
            aria-label={t("bulk.selectCopy", { title: view.title })}
            disabled={!onSelect}
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
  // The collection variant's onRemove is the ⋯ menu's "Remove from this collection".
  // onView is intentionally omitted here: whole-card navigation covers it (stretched link).
  const browseActions = !!(
    (variant !== "collection" && onRemove) ||
    onRequestExchange ||
    onMessage ||
    onFavorite
  );
  const hasBrowseRow = showActions && browseActions;
  const messageLabel = ownerLabel
    ? tCard("messageOwnerName", { name: ownerLabel })
    : tCard("messageOwner");

  // Requesting the copy is what Browse is for, so it is a labelled primary button; Message and the
  // favourite heart are named icon buttons with a tooltip. The heart keeps one name and reports its
  // state through aria-pressed. The two icons wrap together under Request on a card too narrow
  // for all three (two-column tablet grid, longer Dutch label), so Request's label is never cut
  // off and the icons never split up. 40px targets, 44px on touch screens.
  const iconActions = (onMessage || onFavorite) && (
    <div className="ml-auto flex items-center gap-2">
      {onMessage && (
        <Tooltip>
          <TooltipTrigger asChild>
            <Button
              variant="ghost"
              size="icon"
              aria-label={messageLabel}
              onClick={() => onMessage(ownedId)}
              className="size-10 pointer-coarse:size-11"
            >
              <MessageCircle className="h-4 w-4" aria-hidden />
            </Button>
          </TooltipTrigger>
          <TooltipContent>{messageLabel}</TooltipContent>
        </Tooltip>
      )}
      {onFavorite && (
        <Tooltip>
          <TooltipTrigger asChild>
            <Button
              variant="ghost"
              size="icon"
              aria-label={tCard("favorite")}
              aria-pressed={favorited}
              onClick={() => onFavorite(ownedId)}
              className="size-10 pointer-coarse:size-11"
            >
              <Heart
                className={cn(
                  "h-4 w-4",
                  favorited && "fill-red-500 text-red-500",
                )}
                aria-hidden
              />
            </Button>
          </TooltipTrigger>
          <TooltipContent>
            {favorited
              ? tCatalog("removeFromFavorites")
              : tCatalog("addToFavorites")}
          </TooltipContent>
        </Tooltip>
      )}
    </div>
  );
  const actions = hasBrowseRow ? (
    <div className="flex flex-wrap items-center gap-2">
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
          onClick={() => onRequestExchange(ownedId)}
          // A list row can be 850px wide: past a phone, Request keeps its natural width there.
          className={cn(
            "h-10 flex-1 pointer-coarse:h-11",
            viewMode === "list" && "sm:flex-none",
          )}
        >
          <ArrowLeftRight className="h-4 w-4" aria-hidden />
          {tCard("request")}
        </Button>
      )}
      {iconActions}
    </div>
  ) : undefined;

  return (
    <PuzzleCardShell
      puzzle={view}
      selected={isSelected}
      // In the selection picker the whole card toggles selection (not just the
      // checkbox); the checkbox stays as the visible state + keyboard target.
      selectable={variant === "selection" && !!onSelect}
      onSelect={onSelect ? () => onSelect(ownedId) : undefined}
      badges={badges}
      overlay={overlay}
      footer={loanBadge}
      actions={actions}
      // The cover link navigates to the puzzle's view page. With the overflow
      // menu in place, `onView` no longer drives a bottom button — but the
      // stretched link (via imageHref) still handles whole-card navigation.
      // NOT in the selection variant: there the whole card click is the
      // selection action, so a navigating cover link would hijack it.
      imageHref={
        variant !== "selection" && viewBasePath && ownedId
          ? `${viewBasePath}/${ownedId}${viewSearch ?? ""}`
          : undefined
      }
      imageFit={imageFit}
      imageSizes={imageSizes}
      imageChecking={imageChecking}
      className={className}
    />
  );
}
