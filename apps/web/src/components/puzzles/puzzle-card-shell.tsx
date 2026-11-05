"use client";

import { Image } from "@/compat/image";
import { Link } from "@/compat/link";
import { Badge } from "@/components/ui/badge";
import { Card } from "@/components/ui/card";
import { cn } from "@/lib/utils";
import { Puzzle } from "lucide-react";
import type { ReactNode } from "react";
import { useFormatter, useTranslations } from "use-intl";
import { BoxArtCheckingLabel } from "./box-art-checking";
import { difficultyClasses } from "./difficulty-classes";
import { usePuzzleView } from "./puzzle-view-provider";

// Normalized view-model the shell renders. Both the catalog card and the
// owned-copy card map their own DTO into this shape; the shell is the single
// source of card layout truth — the ONLY thing that differs between contexts
// is the action buttons / badges / overlay / footer slots.
export type PuzzleCardView = {
  id: string;
  title: string;
  brand?: string | null;
  pieceCount?: number | null;
  difficulty?: string | null;
  description?: string | null;
  tags?: readonly string[] | null;
  imageUrl?: string | null;
  /** `srcset` for the cover (its renditions plus the original, as URLs), when the read offers
   *  one. Without it the card shows `imageUrl` alone. */
  imageSrcSet?: string | null;
};

export interface PuzzleCardShellProps {
  puzzle: PuzzleCardView;
  /** Action row (e.g. View/Add links, or icon-button callbacks). */
  actions?: ReactNode;
  /** Rendered right under the title, before the brand and pieces: what this card is above all.
   *  A list row keeps to one line, so there it leads the row's badges. */
  leadingMeta?: ReactNode;
  /** Context badges (e.g. availability flags, owner). Rendered under the meta row. */
  badges?: ReactNode;
  /** Overlay rendered over the image (e.g. selection checkmark/checkbox). */
  overlay?: ReactNode;
  /** At the end of a list row (e.g. the ⋯ menu or the selection checkbox); list view only, where
   *  the cover is too small to carry them. */
  rowEnd?: ReactNode;
  /** Footer rendered above the action row (e.g. an "on loan to X" badge). */
  footer?: ReactNode;
  selected?: boolean;
  /** When the whole card is selectable, fired on card click. */
  onSelect?: () => void;
  selectable?: boolean;
  /** When set, the card body links to this href. */
  href?: string;
  /** When set, the cover image links to this href (the puzzle's view page). */
  imageHref?: string;
  /** How the cover image fills its square: "cover" crops to fill (default),
   *  "contain" shows the whole image letterboxed. */
  imageFit?: "cover" | "contain";
  /** The viewer's own box art for this puzzle is still being checked: label the placeholder. */
  imageChecking?: boolean;
  /** `sizes` for the cover in grid view: the cover's rendered width in the caller's grid, so the
   *  browser picks the smallest rendition that is still sharp. Only used with
   *  `puzzle.imageSrcSet`; without it the browser assumes the full viewport width. List view
   *  always uses its fixed thumbnail. */
  imageSizes?: string;
  /**
   * Heading level of the card title: 3 (default) for a grid under a section h2, 2 for a grid
   * that sits directly under the page h1, so the outline never skips a level.
   */
  headingLevel?: 2 | 3;
  /** The cover is above the fold: load it eagerly at high priority (see compat/image). */
  imagePriority?: boolean;
  className?: string;
}

// The list view's thumbnail is at most `size-14` (3.5rem); keep the two in step.
const LIST_COVER_SIZES = "56px";

export function PuzzleCardShell({
  puzzle,
  actions,
  leadingMeta,
  badges,
  overlay,
  rowEnd,
  footer,
  selected = false,
  onSelect,
  selectable = false,
  href,
  imageHref,
  imageFit = "cover",
  imageChecking = false,
  imageSizes,
  headingLevel = 3,
  imagePriority,
  className,
}: PuzzleCardShellProps) {
  const t = useTranslations("puzzles");
  // Difficulty labels live under the nested `puzzles.puzzles.*` namespace.
  const tCat = useTranslations("puzzles.puzzles");
  const format = useFormatter();
  const { viewMode } = usePuzzleView();
  // Grid cards drop to a compact density below sm, where a phone grid leaves
  // each card little room: a 4:3 cover (most box art is landscape), tighter
  // padding, and no description or tags. List rows are their own compact layout (renderListRow).
  const compactOnPhones = viewMode === "grid";
  const Title = `h${headingLevel}` as const;
  // Nothing to say without a count (the add form's preview before one is typed): never "0 pieces".
  const pieceCount = puzzle.pieceCount || undefined;

  const difficultyLabel = (difficulty?: string | null) => {
    switch (difficulty) {
      case "easy":
        return tCat("difficulty.easy");
      case "medium":
        return tCat("difficulty.medium");
      case "hard":
        return tCat("difficulty.hard");
      case "expert":
        return tCat("difficulty.expert");
      default:
        return tCat("difficulty.unknown");
    }
  };

  const renderImage = () => {
    // Box art is optional; when missing, show a warm gradient + puzzle glyph
    // rather than a broken <img> pointing at a non-existent placeholder file.
    // This is THE unified no-image fallback both contexts share.
    const inner = (
      <div
        className={cn(
          "relative overflow-hidden",
          // A list row's thumbnail is a fixed square. A contained cover (and the no-image gradient)
          // fills it, so no blank block sits under it; a "cover" image keeps its own square.
          compactOnPhones
            ? "aspect-[4/3] rounded-t-lg sm:aspect-square"
            : imageFit === "contain" || !puzzle.imageUrl
              ? "h-full rounded-md"
              : "aspect-square rounded-md",
          // A contained cover sits on a muted frame, so its letterbox bands read
          // as part of the cover instead of empty card space.
          puzzle.imageUrl && imageFit === "contain" && "bg-muted",
        )}
      >
        {puzzle.imageUrl ? (
          <Image
            src={puzzle.imageUrl}
            srcSet={puzzle.imageSrcSet ?? undefined}
            sizes={
              puzzle.imageSrcSet
                ? viewMode === "list"
                  ? LIST_COVER_SIZES
                  : imageSizes
                : undefined
            }
            alt={puzzle.title || "Puzzle"}
            fill
            priority={imagePriority}
            className={cn(
              "transition-transform group-hover:scale-105",
              imageFit === "contain" ? "object-contain" : "object-cover",
            )}
          />
        ) : (
          <div className="absolute inset-0 flex items-center justify-center bg-gradient-to-br from-jigsaw-primary/15 to-jigsaw-primary-accent/15 text-jigsaw-primary/50">
            <Puzzle className="h-1/3 w-1/3" />
            {/* Too long for a list row's thumbnail. */}
            {imageChecking && compactOnPhones && <BoxArtCheckingLabel />}
          </div>
        )}
        {overlay}
      </div>
    );
    // The cover is no longer its own link — the whole card is clickable via the
    // stretched title link below (so the image, title and empty card area all
    // navigate, while the action buttons stay pressable above the overlay).
    return inner;
  };

  // Stretched link: the ::after overlay spans the whole (relative) card, so clicking the image,
  // title or any empty area navigates. Action buttons sit above it via `relative z-10` and stay
  // pressable. Its focus is shown as a ring around the whole card (see `data-card-link` on the Card).
  const titleContent = imageHref ? (
    <Link
      href={imageHref}
      data-card-link=""
      className="after:absolute after:inset-0 after:z-[1] after:content-[''] hover:underline focus-visible:underline focus-visible:outline-none"
    >
      {puzzle.title}
    </Link>
  ) : (
    puzzle.title
  );

  // One compact line per puzzle, so a library of hundreds can be scanned: thumbnail, title and
  // brand, pieces, the copy's badges, then ⋯ and its actions at the end of the row. From sm the
  // middle is three columns, so pieces and badges line up from row to row; on a phone pieces and
  // badges flow together under the title. The thumbnail and columns need 34rem to keep the title
  // legible, so actions that don't fit beside that wrap to a line of their own, however wide they
  // are: Browse's labelled Request button until a wide window, a pair of icons much sooner.
  const renderListRow = () => (
    <div className="flex flex-wrap items-center gap-x-3 gap-y-2 p-2 sm:gap-x-4 sm:pr-3">
      <div className="flex min-w-0 flex-[1_1_34rem] items-center gap-x-3 sm:gap-x-4">
        <div className="size-14 shrink-0 sm:size-12">{renderImage()}</div>
        <div className="flex min-w-0 flex-1 basis-0 flex-wrap items-center gap-x-2 gap-y-1 sm:grid sm:grid-cols-[minmax(0,1fr)_6.5rem_minmax(0,1.1fr)] sm:gap-x-4">
          <div className="w-full min-w-0 sm:w-auto">
            <Title className="line-clamp-2 text-sm font-semibold">
              {titleContent}
            </Title>
            {puzzle.brand && (
              <p className="text-muted-foreground truncate text-xs">
                {puzzle.brand}
              </p>
            )}
          </div>
          <div className="text-xs">
            {pieceCount && (
              <>
                {format.number(pieceCount)} {t("pieces", { count: pieceCount })}
              </>
            )}
            {puzzle.difficulty && (
              <span className="text-muted-foreground block truncate max-sm:hidden">
                {difficultyLabel(puzzle.difficulty)}
              </span>
            )}
          </div>
          {/* The badges' own bottom margins are for the stacked grid card. */}
          {(leadingMeta || badges) && (
            <div className="contents [&>*]:mb-0 sm:flex sm:min-w-0 sm:flex-wrap sm:items-center sm:gap-x-2 sm:gap-y-1">
              {leadingMeta}
              {badges}
            </div>
          )}
        </div>
        {rowEnd && (
          <div className="relative z-10 flex shrink-0 items-center">
            {rowEnd}
          </div>
        )}
      </div>
      {(footer || actions) && (
        <div className="relative z-10 flex items-center gap-2 max-sm:w-full max-sm:flex-wrap sm:ml-auto sm:shrink-0">
          {footer}
          {actions}
        </div>
      )}
    </div>
  );

  const renderContent = () => (
    <div className="flex flex-1 flex-col p-3 sm:p-4">
      <div className="mb-2">
        <Title className="font-semibold text-sm line-clamp-2 mb-1">
          {titleContent}
        </Title>
        {leadingMeta}
        {puzzle.brand && (
          <p className="text-xs text-muted-foreground mb-1">{puzzle.brand}</p>
        )}
        <div className="flex flex-wrap items-center gap-2 mb-2">
          {pieceCount && (
            <Badge variant="secondary" className="text-xs">
              {format.number(pieceCount)} {t("pieces", { count: pieceCount })}
            </Badge>
          )}
          {puzzle.difficulty && (
            <Badge
              variant="secondary"
              className={cn("text-xs", difficultyClasses(puzzle.difficulty))}
            >
              {difficultyLabel(puzzle.difficulty)}
            </Badge>
          )}
        </div>
      </div>

      {badges}

      {puzzle.description && (
        <p className="text-xs text-muted-foreground line-clamp-2 mb-2 max-sm:hidden">
          {puzzle.description}
        </p>
      )}

      {/* Tags are plain muted "#tag" text, so they never read as a status or an offer. */}
      {puzzle.tags && puzzle.tags.length > 0 && (
        <p className="flex flex-wrap gap-x-2 gap-y-0.5 mb-2 text-xs text-muted-foreground max-sm:hidden">
          {puzzle.tags.slice(0, 3).map((tag, index) => (
            <span key={index} className="max-w-full truncate">
              #{tag}
            </span>
          ))}
          {puzzle.tags.length > 3 && <span>+{puzzle.tags.length - 3}</span>}
        </p>
      )}

      {/* footer + actions sit ABOVE the stretched-link overlay (relative z-10) so their
          own buttons/links remain clickable. */}
      {footer && <div className="relative z-10 mb-2">{footer}</div>}

      {/* Pin the action row to the bottom so every card in a row shares one baseline, with a
          hairline divider separating it from the (top-packed) content. */}
      {actions && (
        <div className="relative z-10 mt-auto border-t pt-3">{actions}</div>
      )}
    </div>
  );

  // Optionally make the whole card a link or a click-to-select surface; the
  // action slot's own buttons/links stop propagation by virtue of being nested
  // interactive elements.
  const body =
    viewMode === "list" ? (
      renderListRow()
    ) : (
      <>
        {renderImage()}
        {renderContent()}
      </>
    );

  // p-0/gap-0/overflow-hidden so the cover (or its gradient placeholder) sits
  // flush against the card's top edge instead of inset by the Card's default
  // padding; renderContent supplies its own p-4.
  const card = (
    <Card
      className={cn(
        // `group` so the cover zooms on hover of the WHOLE card (the stretched-link
        // overlay covers the image, so image-only :hover no longer fires).
        "group relative h-full gap-0 overflow-hidden p-0",
        // The stretched title link stands for the whole card, so keyboard focus on it rings the
        // card (its underline alone is too faint a cue). Focus on an action button keeps that
        // button's own ring instead.
        "has-[[data-card-link]:focus-visible]:ring-2 has-[[data-card-link]:focus-visible]:ring-ring has-[[data-card-link]:focus-visible]:ring-offset-2 has-[[data-card-link]:focus-visible]:ring-offset-background",
        selected && "ring-2 ring-primary",
        (href || selectable) && "cursor-pointer",
        className,
      )}
      onClick={selectable ? onSelect : undefined}
    >
      {body}
    </Card>
  );

  if (href) {
    return (
      <Link href={href} className="block h-full">
        {card}
      </Link>
    );
  }

  return card;
}
