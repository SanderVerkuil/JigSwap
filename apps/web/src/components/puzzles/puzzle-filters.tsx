"use client";

import { PIECE_PRESETS } from "@/components/add-puzzle/add-puzzle-schema";
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
import { useUrlTextDraft } from "@/hooks/use-url-text-draft";
import type { Locale } from "@/lib/i18n";
import { cn } from "@/lib/utils";
import { convexQuery } from "@convex-dev/react-query";
import { useQuery } from "@tanstack/react-query";
import { X } from "lucide-react";
import { useId } from "react";
import { useFormatter, useLocale, useTranslations } from "use-intl";
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
  /** Receives only what changed, so an edit made later (the range waits for a pause in typing)
   *  can't write back the other filters as they were when it started. */
  onFiltersChange: (patch: Partial<Filters>) => void;
  className?: string;
}

// A typed range bound reaches the URL (and so the server) after this pause in typing.
const RANGE_DEBOUNCE_MS = 300;

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

// One bound of the piece range. It edits a draft that follows the URL; typing 1000 starts one
// search, not four, and a preset picked below it replaces the draft.
function RangeBoundInput({
  value,
  onValueChange,
  label,
  placeholder,
}: {
  value: string;
  onValueChange: (value: string) => void;
  label: string;
  placeholder: string;
}) {
  const { draft, change } = useUrlTextDraft(
    value || undefined,
    (bound) => onValueChange(bound ?? ""),
    RANGE_DEBOUNCE_MS,
  );
  return (
    <Input
      type="number"
      aria-label={label}
      placeholder={placeholder}
      value={draft}
      onChange={(e) => change(e.target.value)}
      className="flex-1"
    />
  );
}

export function PuzzleFilters({
  filters,
  onFiltersChange,
  className = "",
}: PuzzleFiltersProps) {
  const t = useTranslations("puzzles.puzzles");
  const tPuzzles = useTranslations("puzzles");
  const format = useFormatter();

  // Each read drives only its own control: a failing or slow one must not hold up the others.
  const brands = useQuery(convexQuery(gateway.catalog.allBrands, {}));

  // The public taxonomy: active categories only, readable by every member (the admin listAll
  // read is admin-only and includes deactivated rows).
  const categories = useQuery(
    convexQuery(gateway.catalog.puzzleCategories, {}),
  );
  const locale = useLocale() as Locale;

  const allTags = useQuery(convexQuery(gateway.catalog.allTags, {}));

  const piecesLabelId = useId();

  const updateFilter = (key: keyof Filters, value: string | string[]) => {
    onFiltersChange({ [key]: value });
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

      {/* One piece range: typed, or a common count picked as a preset (that exact count, the same
          presets the contribute form offers). */}
      <div role="group" aria-labelledby={piecesLabelId} className="space-y-2">
        <Label id={piecesLabelId}>{t("filters.pieces")}</Label>
        <div className="flex gap-2">
          <RangeBoundInput
            label={t("filters.minPieces")}
            placeholder={t("filters.min")}
            value={filters.minPieces}
            onValueChange={(value) => updateFilter("minPieces", value)}
          />
          <span className="flex items-center text-muted-foreground">-</span>
          <RangeBoundInput
            label={t("filters.maxPieces")}
            placeholder={t("filters.max")}
            value={filters.maxPieces}
            onValueChange={(value) => updateFilter("maxPieces", value)}
          />
        </div>
        <div className="flex flex-wrap gap-1.5">
          {PIECE_PRESETS.map((count) => {
            const on =
              filters.minPieces === String(count) &&
              filters.maxPieces === String(count);
            return (
              <button
                key={count}
                type="button"
                aria-pressed={on}
                aria-label={`${format.number(count)} ${tPuzzles("pieces", { count })}`}
                onClick={() =>
                  onFiltersChange(
                    on
                      ? { minPieces: "", maxPieces: "" }
                      : {
                          minPieces: String(count),
                          maxPieces: String(count),
                        },
                  )
                }
                className={cn(
                  "border-border cursor-pointer rounded-full border px-2.5 py-1 font-mono text-xs transition-colors pointer-coarse:min-h-9",
                  on
                    ? "bg-jigsaw-primary-tint text-primary-text ring-primary-text ring-1 ring-inset"
                    : "bg-card text-muted-foreground hover:bg-accent",
                )}
              >
                {format.number(count)}
              </button>
            );
          })}
        </div>
      </div>

      {/* Tags Filter */}
      <div className="space-y-2 md:col-span-2">
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
