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
import { difficultyClasses } from "./catalog-detail-parts";
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
  /** Context badges (e.g. availability flags, owner). Rendered under the meta row. */
  badges?: ReactNode;
  /** Overlay rendered over the image (e.g. selection checkmark/checkbox). */
  overlay?: ReactNode;
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
   *  always uses the fixed 128px cover column. */
  imageSizes?: string;
  className?: string;
}

// The list view's cover column is `w-32` (8rem); keep the two in step.
const LIST_COVER_SIZES = "128px";

export function PuzzleCardShell({
  puzzle,
  actions,
  badges,
  overlay,
  footer,
  selected = false,
  onSelect,
  selectable = false,
  href,
  imageHref,
  imageFit = "cover",
  imageChecking = false,
  imageSizes,
  className,
}: PuzzleCardShellProps) {
  const t = useTranslations("puzzles");
  // Difficulty labels live under the nested `puzzles.puzzles.*` namespace.
  const tCat = useTranslations("puzzles.puzzles");
  const format = useFormatter();
  const { viewMode } = usePuzzleView();
  // Grid cards drop to a compact density below sm, where a phone grid leaves
  // each card little room: a 4:3 cover (most box art is landscape), tighter
  // padding, and no description or tags. List rows keep one layout throughout.
  const compactOnPhones = viewMode === "grid";

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
          "relative overflow-hidden rounded-t-lg",
          compactOnPhones ? "aspect-[4/3] sm:aspect-square" : "aspect-square",
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
            className={cn(
              "transition-transform group-hover:scale-105",
              imageFit === "contain" ? "object-contain" : "object-cover",
            )}
          />
        ) : (
          <div className="absolute inset-0 flex items-center justify-center bg-gradient-to-br from-jigsaw-primary/15 to-jigsaw-primary-accent/15 text-jigsaw-primary/50">
            <Puzzle className="h-1/3 w-1/3" />
            {imageChecking && <BoxArtCheckingLabel />}
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

  const renderContent = () => (
    <div
      className={cn(
        "flex flex-1 flex-col",
        compactOnPhones ? "p-3 sm:p-4" : "p-4",
      )}
    >
      <div className="mb-2">
        <h3 className="font-semibold text-sm line-clamp-2 mb-1">
          {imageHref ? (
            // Stretched link: the ::after overlay spans the whole (relative) card, so
            // clicking the image, title or any empty area navigates. Action buttons
            // sit above it via `relative z-10` and stay pressable. Its focus is shown
            // as a ring around the whole card (see `data-card-link` on the Card).
            <Link
              href={imageHref}
              data-card-link=""
              className="after:absolute after:inset-0 after:z-[1] after:content-[''] hover:underline focus-visible:underline focus-visible:outline-none"
            >
              {puzzle.title}
            </Link>
          ) : (
            puzzle.title
          )}
        </h3>
        {puzzle.brand && (
          <p className="text-xs text-muted-foreground mb-1">{puzzle.brand}</p>
        )}
        <div className="flex flex-wrap items-center gap-2 mb-2">
          <Badge variant="secondary" className="text-xs">
            {format.number(puzzle.pieceCount ?? 0)} {t("pieces")}
          </Badge>
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
        <p
          className={cn(
            "text-xs text-muted-foreground line-clamp-2 mb-2",
            compactOnPhones && "max-sm:hidden",
          )}
        >
          {puzzle.description}
        </p>
      )}

      {/* Tags are plain muted "#tag" text, so they never read as a status or an offer. */}
      {puzzle.tags && puzzle.tags.length > 0 && (
        <p
          className={cn(
            "flex flex-wrap gap-x-2 gap-y-0.5 mb-2 text-xs text-muted-foreground",
            compactOnPhones && "max-sm:hidden",
          )}
        >
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
      <div className="flex h-full">
        <div className="w-32 flex-shrink-0">{renderImage()}</div>
        <div className="flex flex-1 flex-col">{renderContent()}</div>
      </div>
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
