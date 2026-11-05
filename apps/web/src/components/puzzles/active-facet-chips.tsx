"use client";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { gateway } from "@/gateway";
import {
  catalogueSearchArgs,
  type CatalogueFilters,
} from "@/lib/catalogue-filters";
import type { Locale } from "@/lib/i18n";
import { convexQuery } from "@convex-dev/react-query";
import { useQuery } from "@tanstack/react-query";
import { X } from "lucide-react";
import { useFormatter, useLocale, useTranslations } from "use-intl";
import { categoryOptions } from "./category-options";

// What narrows the catalogue while the Filters panel is closed: one removable chip per facet, so
// the results never look complete when they aren't. The term and favourites show in the toolbar.
export function ActiveFacetChips({
  filters,
  onRemove,
}: {
  filters: CatalogueFilters;
  /** Receives only what changed, like the panel's onFiltersChange. */
  onRemove: (patch: Partial<CatalogueFilters>) => void;
}) {
  const t = useTranslations("puzzles.puzzles");
  const tPuzzles = useTranslations("puzzles");
  const format = useFormatter();
  const locale = useLocale() as Locale;
  const { data: categories } = useQuery(
    convexQuery(
      gateway.catalog.puzzleCategories,
      filters.category ? {} : "skip",
    ),
  );

  // The same reading of the bounds the search uses: dropped if unusable, inverted put right.
  const { pieceMin, pieceMax } = catalogueSearchArgs(filters);
  const piecesLabel = () => {
    if (pieceMin !== undefined && pieceMin === pieceMax) {
      return `${format.number(pieceMin)} ${tPuzzles("pieces", { count: pieceMin })}`;
    }
    if (pieceMin !== undefined && pieceMax !== undefined) {
      return t("filters.piecesRange", {
        min: format.number(pieceMin),
        max: format.number(pieceMax),
      });
    }
    return pieceMin !== undefined
      ? t("filters.piecesFrom", { min: format.number(pieceMin) })
      : t("filters.piecesUpTo", { max: format.number(pieceMax ?? 0) });
  };

  const chips: {
    key: string;
    label: string;
    patch: Partial<CatalogueFilters>;
  }[] = [
    ...(filters.brand
      ? [{ key: "brand", label: filters.brand, patch: { brand: "" } }]
      : []),
    ...(pieceMin !== undefined || pieceMax !== undefined
      ? [
          {
            key: "pieces",
            label: piecesLabel(),
            patch: { minPieces: "", maxPieces: "" },
          },
        ]
      : []),
    ...(filters.difficulty
      ? [
          {
            key: "difficulty",
            label: t(`difficulty.${filters.difficulty}` as "difficulty.easy"),
            patch: { difficulty: "" },
          },
        ]
      : []),
    ...(filters.category
      ? [
          {
            key: "category",
            // The category's name once the taxonomy is in; it is one read for the whole list.
            label:
              categoryOptions(categories ?? [], locale).find(
                (option) => option.value === filters.category,
              )?.label ?? t("filters.category"),
            patch: { category: "" },
          },
        ]
      : []),
    ...filters.tags.map((tag) => ({
      key: `tag-${tag}`,
      label: tag,
      patch: { tags: filters.tags.filter((other) => other !== tag) },
    })),
  ];

  return (
    <ul className="mt-4 flex flex-wrap gap-2">
      {chips.map(({ key, label, patch }) => (
        <li key={key} className="max-w-full">
          <Badge variant="secondary" className="max-w-full gap-1">
            <span className="truncate">{label}</span>
            <Button
              variant="ghost"
              size="sm"
              aria-label={t("filters.removeFilter", { label })}
              className="hover:text-destructive -my-1 -mr-1 size-6 p-0 has-[>svg]:p-0"
              onClick={() => onRemove(patch)}
            >
              <X className="h-3 w-3" />
            </Button>
          </Badge>
        </li>
      ))}
    </ul>
  );
}
