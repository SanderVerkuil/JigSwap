"use client";

import { Image } from "@/compat/image";
import { Link } from "@/compat/link";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import type { gateway } from "@/gateway";
import type { FunctionReturnType } from "convex/server";
import { Check, Info, Plus } from "lucide-react";
import { useTranslations } from "use-intl";
import { addCopyHref, PuzzleCard } from "./puzzle-card";
import { PuzzleViewProvider } from "./puzzle-view-provider";

type Puzzle = FunctionReturnType<typeof gateway.catalog.recentPuzzles>[number];

// The Add Puzzle chooser's results. Every entry opens the add-a-copy form for that puzzle and is
// marked "On your shelf" when the member already owns a copy (matched on the catalogue definition
// id, like the quick picker). Phones get the quick picker's compact rows, with a ≥48px tap
// target each; from sm up the pick cards. Both are rendered and toggled with CSS, so the server
// render already has the right layout and nothing jumps on hydration.
export function PuzzlePickList({
  puzzles,
  ownedDefinitionIds,
}: {
  puzzles: readonly Puzzle[];
  ownedDefinitionIds: ReadonlySet<string>;
}) {
  const t = useTranslations("puzzles");
  const tPicker = useTranslations("cataloguePicker");
  const onShelf = (puzzle: Puzzle) =>
    !!puzzle.aggregateId && ownedDefinitionIds.has(puzzle.aggregateId);

  return (
    <>
      <ul
        data-testid="pick-rows"
        className="divide-border flex flex-col divide-y overflow-hidden rounded-xl border sm:hidden"
      >
        {puzzles.map((puzzle) => (
          <li key={puzzle._id} className="flex items-center">
            {/* Named by its visible text (title, shelf mark, meta) so the label is in the name,
                followed by what it does. */}
            <Link
              href={addCopyHref(puzzle._id)}
              className="hover:bg-accent focus-visible:ring-ring/50 flex min-h-12 min-w-0 flex-1 items-center gap-3 py-2 pl-3 text-left transition-colors outline-none focus-visible:ring-[3px] focus-visible:ring-inset motion-reduce:transition-none"
            >
              <span className="bg-muted size-10 shrink-0 overflow-hidden rounded-md">
                {puzzle.image && (
                  <Image
                    src={puzzle.image}
                    alt=""
                    width={40}
                    height={40}
                    className="h-full w-full object-cover"
                  />
                )}
              </span>
              <span className="min-w-0 flex-1">
                <span className="block truncate text-sm font-semibold">
                  {puzzle.title}
                </span>
                {/* The shelf mark sits under the title, so it never squeezes the title on a
                    phone. */}
                <span className="flex min-w-0 items-center gap-1.5 text-xs">
                  {onShelf(puzzle) && (
                    <Badge variant="outline" className="py-0">
                      <Check aria-hidden />
                      {tPicker("onShelf")}
                    </Badge>
                  )}
                  <span className="text-muted-foreground truncate">
                    {[
                      puzzle.brand,
                      puzzle.pieceCount &&
                        `${puzzle.pieceCount} ${t("pieces")}`,
                    ]
                      .filter(Boolean)
                      .join(" · ")}
                  </span>
                </span>
              </span>
              <Plus
                aria-hidden
                className="text-muted-foreground size-5 shrink-0"
              />
              <span className="sr-only">{t("addToLibrary")}</span>
            </Link>
            <Button
              variant="ghost"
              size="icon"
              asChild
              className="text-muted-foreground size-12 shrink-0 rounded-none"
            >
              <Link
                href={`/puzzles/${puzzle._id}`}
                aria-label={t("chooser.detailsOf", { title: puzzle.title })}
              >
                <Info aria-hidden className="size-5" />
              </Link>
            </Button>
          </li>
        ))}
      </ul>
      <PuzzleViewProvider
        viewMode="grid"
        className="hidden grid-cols-[repeat(auto-fill,minmax(212px,1fr))] gap-[18px] sm:grid"
      >
        {puzzles.map((puzzle) => (
          <PuzzleCard
            key={puzzle._id}
            variant="pick"
            puzzle={puzzle}
            onShelf={onShelf(puzzle)}
          />
        ))}
      </PuzzleViewProvider>
    </>
  );
}
