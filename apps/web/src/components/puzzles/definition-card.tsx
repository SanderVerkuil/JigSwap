"use client";

import { Link } from "@/compat/link";
import { gateway } from "@/gateway";
import type { FunctionReturnType } from "convex/server";
import { Puzzle, Star } from "lucide-react";
import { useTranslations } from "use-intl";
import type { PuzzleCardShellProps } from "./puzzle-card-shell";

// One box in the public catalogue, derived from the paginated public-browse read it is fed by. It stands
// on the plank-tan ledge the home page's shelves use, at its own height, with plain facts under it, so
// the grid reads as shelves and not as cards. Deliberately member-free: no owner identities, no
// copy-level badges, just catalogue facts and community aggregates.
type CatalogCard = FunctionReturnType<
  typeof gateway.catalog.publicBrowse
>["page"][number];

export function DefinitionCard({
  card,
  imageSizes,
  headingLevel,
  priority,
}: {
  card: CatalogCard;
  /** The cover's `sizes` in the caller's grid (see PuzzleCardShell's imageSizes). */
  imageSizes?: string;
  /** Card title heading level; 2 when the grid sits directly under the page h1. */
  headingLevel?: PuzzleCardShellProps["headingLevel"];
  /** Above the fold (the grid's first row): fetch the cover eagerly, first. */
  priority?: boolean;
}) {
  const t = useTranslations("publicCatalog");
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
      <div className="flex h-[clamp(140px,17vw,250px)] items-end justify-center px-[clamp(8px,1.4vw,20px)]">
        {card.image ? (
          <img
            src={card.image}
            srcSet={card.imageSrcSet ?? undefined}
            sizes={card.imageSrcSet ? imageSizes : undefined}
            alt=""
            loading={priority ? "eager" : "lazy"}
            fetchPriority={priority ? "high" : undefined}
            decoding="async"
            className="block h-auto max-h-full w-auto max-w-full rounded-t-[2px]"
          />
        ) : (
          <div className="bg-mk-sky-soft dark:bg-mk-muted text-mk-text-muted flex aspect-[4/3] w-full items-center justify-center rounded-t-[2px]">
            <Puzzle aria-hidden="true" className="h-1/3 w-1/3" />
          </div>
        )}
      </div>
      <div aria-hidden="true" className="bg-mk-plank h-[9px] shrink-0" />
      <div className="text-mk-text-strong flex flex-1 flex-col items-start px-[clamp(8px,1.4vw,20px)] pt-3">
        <Title className="text-[17px] leading-snug font-bold">
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
          {card.pieceCount ?? 0} {tPuzzles("pieces")}
          {difficulty && `, ${difficulty.toLowerCase()}`}
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
