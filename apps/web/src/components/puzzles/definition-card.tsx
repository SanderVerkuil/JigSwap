"use client";

import { Link } from "@/compat/link";
import { BoxFace, ShelfLedge } from "@/components/shelf/box-face";
import { boxScale } from "@/components/shelf/box-size";
import { gateway } from "@/gateway";
import type { FunctionReturnType } from "convex/server";
import { Star } from "lucide-react";
import type * as React from "react";
import { useFormatter, useTranslations } from "use-intl";
import type { PuzzleCardShellProps } from "./puzzle-card-shell";

// One box in the public catalogue, derived from the paginated public-browse read it is fed by. It is
// the shelf's own box and ledge (components/shelf): standing on the plank-tan ledge at its own height,
// a 1,000-piece box the column's width and a smaller puzzle's box narrower, a painted lid when it has
// no art, with plain facts under it, so the grid reads as shelves and not as cards. Deliberately
// member-free: no owner identities, no copy-level badges, just catalogue facts and community
// aggregates.
type CatalogCard = FunctionReturnType<
  typeof gateway.catalog.publicBrowse
>["page"][number];

export function DefinitionCard({
  card,
  imageSizes,
  headingLevel,
  priority,
  index = 0,
}: {
  card: CatalogCard;
  /** The cover's `sizes` in the caller's grid (see PuzzleCardShell's imageSizes). */
  imageSizes?: string;
  /** Card title heading level; 2 when the grid sits directly under the page h1. */
  headingLevel?: PuzzleCardShellProps["headingLevel"];
  /** Above the fold (the grid's first row): fetch the cover eagerly, first. */
  priority?: boolean;
  /** Its place in the grid: picks a painted lid's colour. */
  index?: number;
}) {
  const t = useTranslations("publicCatalog");
  const format = useFormatter();
  const Title = `h${headingLevel ?? 3}` as const;
  const tPuzzles = useTranslations("puzzles");
  // Difficulty labels live under the nested `puzzles.puzzles.*` namespace.
  const tCat = useTranslations("puzzles.puzzles");

  const difficulty =
    card.difficulty === "easy" ||
    card.difficulty === "medium" ||
    card.difficulty === "hard" ||
    card.difficulty === "expert"
      ? tCat(`difficulty.${card.difficulty}`)
      : null;

  return (
    <article className="group relative flex h-full flex-col">
      <div
        className="flex h-[clamp(140px,17vw,250px)] items-end justify-center px-[clamp(8px,1.4vw,20px)]"
        // The slot is the box's room: a 1,000-piece box (or bigger) the column's width, its height.
        style={
          {
            "--unit": "100%",
            "--row-h": "100%",
            "--scale": Math.min(1, boxScale(card.pieceCount ?? undefined)),
          } as React.CSSProperties
        }
      >
        <BoxFace
          box={{
            id: card._id,
            title: card.title,
            brand: card.brand ?? undefined,
            pieceCount: card.pieceCount ?? undefined,
            cover: card.image ?? undefined,
          }}
          index={index}
          named={false}
          srcSet={card.imageSrcSet ?? undefined}
          sizes={imageSizes}
          priority={priority}
        />
      </div>
      <ShelfLedge className="shrink-0" />
      <div className="text-mk-text-strong flex flex-1 flex-col items-start px-[clamp(8px,1.4vw,20px)] pt-3">
        {/* The columns meet so the planks run on: a long Dutch compound must break inside its own
            card, not run into the next one. It hyphenates at a syllable by <html lang>; anywhere is
            the fallback for a word the dictionary can't split. */}
        <Title className="line-clamp-3 text-[17px] leading-snug font-bold hyphens-auto [overflow-wrap:anywhere]">
          {/* The whole box is the link: the ::after spans the article. */}
          <Link
            href={`/catalog/${card._id}`}
            className="after:absolute after:inset-0 after:content-[''] group-hover:underline group-hover:decoration-2 group-hover:underline-offset-4 focus-visible:underline focus-visible:outline-none focus-visible:after:outline-3 focus-visible:after:outline-offset-2 focus-visible:after:outline-current"
          >
            {card.title}
          </Link>
        </Title>
        {card.brand && (
          <p className="text-mk-text-muted text-[16px] leading-snug">
            {card.brand}
          </p>
        )}
        <p className="text-[16px] leading-snug">
          {card.pieceCount != null &&
            `${format.number(card.pieceCount)} ${tPuzzles("pieces", { count: card.pieceCount })}`}
          {difficulty &&
            `${card.pieceCount != null ? ", " : ""}${difficulty.toLowerCase()}`}
        </p>
        {card.rating.count > 0 && (
          <p className="text-mk-text-muted mt-1 flex items-center gap-1 text-[16px]">
            <Star
              aria-hidden="true"
              className="fill-mk-gold text-mk-gold h-3.5 w-3.5"
            />
            {card.rating.value} ({card.rating.count})
          </p>
        )}
        {card.availableToSwap > 0 && (
          <p className="bg-mk-canal text-mk-on-canal mt-2 rounded-sm px-2 py-0.5 text-[14px] font-semibold">
            {t("toSwap", { count: card.availableToSwap })}
          </p>
        )}
      </div>
    </article>
  );
}
