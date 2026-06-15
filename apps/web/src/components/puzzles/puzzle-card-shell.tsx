"use client";

import { Image } from "@/compat/image";
import { Link } from "@/compat/link";
import { Badge } from "@/components/ui/badge";
import { Card } from "@/components/ui/card";
import { cn } from "@/lib/utils";
import { Puzzle } from "lucide-react";
import type { ReactNode } from "react";
import { useTranslations } from "use-intl";
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
  className?: string;
}

// Difficulty colour swatch, shared with the catalog card's original helper.
function difficultyColor(difficulty?: string | null) {
  switch (difficulty) {
    case "easy":
      return "bg-green-100 text-green-800";
    case "medium":
      return "bg-yellow-100 text-yellow-800";
    case "hard":
      return "bg-orange-100 text-orange-800";
    case "expert":
      return "bg-red-100 text-red-800";
    default:
      return "bg-gray-100 text-gray-800";
  }
}

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
  className,
}: PuzzleCardShellProps) {
  const t = useTranslations("puzzles");
  // Difficulty labels live under the nested `puzzles.puzzles.*` namespace.
  const tCat = useTranslations("puzzles.puzzles");
  const { viewMode } = usePuzzleView();

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
      <div className="relative aspect-square overflow-hidden rounded-t-lg">
        {puzzle.imageUrl ? (
          <Image
            src={puzzle.imageUrl}
            alt={puzzle.title || "Puzzle"}
            fill
            className="object-cover transition-transform hover:scale-105"
          />
        ) : (
          <div className="absolute inset-0 flex items-center justify-center bg-gradient-to-br from-jigsaw-primary/15 to-jigsaw-primary-accent/15 text-jigsaw-primary/50">
            <Puzzle className="h-1/3 w-1/3" />
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
    <div className="flex flex-1 flex-col p-4">
      <div className="mb-2">
        <h3 className="font-semibold text-sm line-clamp-2 mb-1">
          {imageHref ? (
            // Stretched link: the ::after overlay spans the whole (relative) card, so
            // clicking the image, title or any empty area navigates. Action buttons
            // sit above it via `relative z-10` and stay pressable.
            <Link
              href={imageHref}
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
            {puzzle.pieceCount ?? 0} {t("pieces")}
          </Badge>
          {puzzle.difficulty && (
            <Badge
              variant="secondary"
              className={cn("text-xs", difficultyColor(puzzle.difficulty))}
            >
              {difficultyLabel(puzzle.difficulty)}
            </Badge>
          )}
        </div>
      </div>

      {badges}

      {puzzle.description && (
        <p className="text-xs text-muted-foreground line-clamp-2 mb-2">
          {puzzle.description}
        </p>
      )}

      {puzzle.tags && puzzle.tags.length > 0 && (
        <div className="flex flex-wrap gap-1 mb-2">
          {puzzle.tags.slice(0, 3).map((tag, index) => (
            <Badge key={index} variant="outline" className="text-xs">
              {tag}
            </Badge>
          ))}
          {puzzle.tags.length > 3 && (
            <Badge variant="outline" className="text-xs">
              +{puzzle.tags.length - 3}
            </Badge>
          )}
        </div>
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
        "relative h-full gap-0 overflow-hidden p-0",
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
