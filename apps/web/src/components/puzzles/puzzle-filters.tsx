"use client";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Skeleton } from "@/components/ui/skeleton";
import { gateway } from "@/gateway";
import type { Locale } from "@/lib/i18n";
import { convexQuery } from "@convex-dev/react-query";
import { useQuery } from "@tanstack/react-query";
import { X } from "lucide-react";
import { useLocale, useTranslations } from "use-intl";
import { categoryOptions } from "./category-options";

interface Filters {
  searchTerm: string;
  brand: string;
  minPieces: string;
  maxPieces: string;
  difficulty: string;
  category: string;
  tags: string[];
}

interface PuzzleFiltersProps {
  filters: Filters;
  onFiltersChange: (filters: Filters) => void;
  className?: string;
}

const COMMON_PIECE_COUNTS = [
  100, 200, 300, 400, 500, 750, 1000, 1500, 2000, 3000, 4000, 5000,
];

// Radix Select forbids an empty item value, so the "any" choice of every select carries this
// sentinel and maps back to the filters' empty string.
const ANY = "__any__";

interface FilterSelectProps {
  id: string;
  label: string;
  value: string;
  onValueChange: (value: string) => void;
  /** Label of the choice that clears this filter, e.g. "All brands". */
  anyLabel: string;
  /** Undefined while the options are still loading. */
  options: { value: string; label: string }[] | undefined;
  /** Shown in a disabled control when the options could not be loaded. */
  unavailableLabel?: string;
  isError?: boolean;
}

// One labelled filter select that loads and fails on its own, so a failing read never blocks the
// rest of the panel.
function FilterSelect({
  id,
  label,
  value,
  onValueChange,
  anyLabel,
  options,
  unavailableLabel,
  isError = false,
}: FilterSelectProps) {
  return (
    <div className="space-y-2">
      <Label htmlFor={id}>{label}</Label>
      {isError ? (
        <Select disabled>
          <SelectTrigger id={id} className="w-full">
            <SelectValue placeholder={unavailableLabel} />
          </SelectTrigger>
        </Select>
      ) : options === undefined ? (
        <Skeleton className="h-9 w-full" />
      ) : (
        <Select
          value={value || ANY}
          onValueChange={(next) => onValueChange(next === ANY ? "" : next)}
        >
          <SelectTrigger id={id} className="w-full">
            <SelectValue placeholder={anyLabel} />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value={ANY}>{anyLabel}</SelectItem>
            {options.map((option) => (
              <SelectItem key={option.value} value={option.value}>
                {option.label}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      )}
    </div>
  );
}

export function PuzzleFilters({
  filters,
  onFiltersChange,
  className = "",
}: PuzzleFiltersProps) {
  const t = useTranslations("puzzles.puzzles");
  const tPuzzles = useTranslations("puzzles");

  // Each read drives only its own control: a failing or slow one must not hold up the others.
  const brands = useQuery(convexQuery(gateway.catalog.allBrands, {}));

  // The public taxonomy: active categories only, readable by every member (the admin listAll
  // read is admin-only and includes deactivated rows).
  const categories = useQuery(
    convexQuery(gateway.catalog.puzzleCategories, {}),
  );
  const locale = useLocale() as Locale;

  const allTags = useQuery(convexQuery(gateway.catalog.allTags, {}));

  const pieceOptions = COMMON_PIECE_COUNTS.map((count) => ({
    value: count.toString(),
    label: `${count} ${tPuzzles("pieces")}`,
  }));

  const updateFilter = (key: keyof Filters, value: string | string[]) => {
    onFiltersChange({ ...filters, [key]: value });
  };

  const removeTag = (tagToRemove: string) => {
    updateFilter(
      "tags",
      filters.tags.filter((tag) => tag !== tagToRemove),
    );
  };

  const addTag = (tag: string) => {
    if (!filters.tags.includes(tag)) {
      updateFilter("tags", [...filters.tags, tag]);
    }
  };

  return (
    <div
      className={`grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4 ${className}`}
    >
      <FilterSelect
        id="brand-filter"
        label={t("filters.brand")}
        value={filters.brand}
        onValueChange={(value) => updateFilter("brand", value)}
        anyLabel={t("filters.allBrands")}
        options={brands.data?.map((brand) => ({ value: brand, label: brand }))}
        isError={brands.isError}
        unavailableLabel={t("filters.brandsUnavailable")}
      />

      <FilterSelect
        id="min-pieces"
        label={t("filters.minPieces")}
        value={filters.minPieces}
        onValueChange={(value) => updateFilter("minPieces", value)}
        anyLabel={t("filters.noMinimum")}
        options={pieceOptions}
      />

      <FilterSelect
        id="max-pieces"
        label={t("filters.maxPieces")}
        value={filters.maxPieces}
        onValueChange={(value) => updateFilter("maxPieces", value)}
        anyLabel={t("filters.noMaximum")}
        options={pieceOptions}
      />

      <FilterSelect
        id="difficulty-filter"
        label={t("filters.difficulty")}
        value={filters.difficulty}
        onValueChange={(value) => updateFilter("difficulty", value)}
        anyLabel={t("filters.allDifficulties")}
        options={(["easy", "medium", "hard", "expert"] as const).map(
          (level) => ({ value: level, label: t(`difficulty.${level}`) }),
        )}
      />

      <FilterSelect
        id="category-filter"
        label={t("filters.category")}
        value={filters.category}
        onValueChange={(value) => updateFilter("category", value)}
        anyLabel={t("filters.allCategories")}
        options={categories.data && categoryOptions(categories.data, locale)}
        isError={categories.isError}
        unavailableLabel={t("filters.categoriesUnavailable")}
      />

      {/* Custom Piece Count Range */}
      <div className="space-y-2">
        <Label>{t("filters.customRange")}</Label>
        <div className="flex gap-2">
          <Input
            type="number"
            placeholder={t("filters.min")}
            value={filters.minPieces}
            onChange={(e) => updateFilter("minPieces", e.target.value)}
            className="flex-1"
          />
          <span className="flex items-center text-muted-foreground">-</span>
          <Input
            type="number"
            placeholder={t("filters.max")}
            value={filters.maxPieces}
            onChange={(e) => updateFilter("maxPieces", e.target.value)}
            className="flex-1"
          />
        </div>
      </div>

      {/* Tags Filter */}
      <div className="space-y-2 md:col-span-2 lg:col-span-3">
        <Label>{t("filters.tags")}</Label>

        {/* Selected Tags */}
        {filters.tags.length > 0 && (
          <div className="flex flex-wrap gap-2 mb-2">
            {filters.tags.map((tag) => (
              <Badge key={tag} variant="secondary" className="gap-1">
                {tag}
                <Button
                  variant="ghost"
                  size="sm"
                  aria-label={t("filters.removeTag", { tag })}
                  className="h-auto p-0 has-[>svg]:p-0 hover:text-destructive"
                  onClick={() => removeTag(tag)}
                >
                  <X className="h-3 w-3" />
                </Button>
              </Badge>
            ))}
          </div>
        )}

        {/* Available Tags */}
        {allTags.isError ? (
          <p className="text-sm text-muted-foreground">
            {t("filters.tagsUnavailable")}
          </p>
        ) : allTags.data === undefined ? (
          <div className="flex flex-wrap gap-2">
            {[0, 1, 2].map((i) => (
              <Skeleton key={i} className="h-8 w-20" />
            ))}
          </div>
        ) : (
          <div className="flex flex-wrap gap-2">
            {allTags.data
              .filter((tag) => !filters.tags.includes(tag))
              .slice(0, 10)
              .map((tag) => (
                <Button
                  key={tag}
                  variant="outline"
                  size="sm"
                  onClick={() => addTag(tag)}
                  className="text-xs"
                >
                  + {tag}
                </Button>
              ))}
          </div>
        )}
      </div>
    </div>
  );
}
