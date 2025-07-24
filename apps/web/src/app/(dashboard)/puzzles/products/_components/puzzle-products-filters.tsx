"use client";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { LoadingState } from "@/components/ui/loading";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { api } from "@jigswap/backend/convex/_generated/api";
import { useQuery } from "convex/react";
import { X } from "lucide-react";
import { useTranslations } from "next-intl";

interface Filters {
  searchTerm: string;
  brand: string;
  minPieces: string;
  maxPieces: string;
  difficulty: string;
  category: string;
  tags: string[];
}

interface PuzzleProductsFiltersProps {
  filters: Filters;
  onFiltersChange: (filters: Filters) => void;
  className?: string;
}

const COMMON_PIECE_COUNTS = [
  100, 200, 300, 400, 500, 750, 1000, 1500, 2000, 3000, 4000, 5000,
];

export function PuzzleProductsFilters({
  filters,
  onFiltersChange,
  className = "",
}: PuzzleProductsFiltersProps) {
  const t = useTranslations("puzzles.products");
  const tPuzzles = useTranslations("puzzles");

  // Extract unique brands and categories from products
  const brands = useQuery(api.puzzles.getAllBrands);

  const categories = useQuery(api.adminCategories.getAllAdminCategories);

  // Extract all unique tags
  const allTags = useQuery(api.puzzles.getAllTags);

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

  if (!brands || !categories || !allTags) {
    return <LoadingState />;
  }

  return (
    <div
      className={`grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4 ${className}`}
    >
      {/* Brand Filter */}
      <div className="space-y-2">
        <Label htmlFor="brand-filter">{t("filters.brand")}</Label>
        <Select
          value={filters.brand}
          onValueChange={(value) => updateFilter("brand", value)}
        >
          <SelectTrigger id="brand-filter" className="w-full">
            <SelectValue placeholder={t("filters.allBrands")} />
          </SelectTrigger>
          <SelectContent>
            {brands.map((brand) => (
              <SelectItem key={brand} value={brand || ""}>
                {brand}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>

      {/* Min Pieces Filter */}
      <div className="space-y-2">
        <Label htmlFor="min-pieces">{t("filters.minPieces")}</Label>
        <Select
          value={filters.minPieces}
          onValueChange={(value) => updateFilter("minPieces", value)}
        >
          <SelectTrigger id="min-pieces" className="w-full">
            <SelectValue placeholder={t("filters.noMinimum")} />
          </SelectTrigger>
          <SelectContent>
            {COMMON_PIECE_COUNTS.map((count) => (
              <SelectItem key={count} value={count.toString()}>
                {count} {tPuzzles("pieces")}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>

      {/* Max Pieces Filter */}
      <div className="space-y-2">
        <Label htmlFor="max-pieces">{t("filters.maxPieces")}</Label>
        <Select
          value={filters.maxPieces}
          onValueChange={(value) => updateFilter("maxPieces", value)}
        >
          <SelectTrigger id="max-pieces" className="w-full">
            <SelectValue placeholder={t("filters.selectMaxPieces")} />
          </SelectTrigger>
          <SelectContent>
            {COMMON_PIECE_COUNTS.map((count) => (
              <SelectItem key={count} value={count.toString()}>
                {count} {tPuzzles("pieces")}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>

      {/* Difficulty Filter */}
      <div className="space-y-2">
        <Label htmlFor="difficulty-filter">{t("filters.difficulty")}</Label>
        <Select
          value={filters.difficulty}
          onValueChange={(value) => updateFilter("difficulty", value)}
        >
          <SelectTrigger id="difficulty-filter" className="w-full">
            <SelectValue placeholder={t("filters.allDifficulties")} />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="easy">{t("difficulty.easy")}</SelectItem>
            <SelectItem value="medium">{t("difficulty.medium")}</SelectItem>
            <SelectItem value="hard">{t("difficulty.hard")}</SelectItem>
            <SelectItem value="expert">{t("difficulty.expert")}</SelectItem>
          </SelectContent>
        </Select>
      </div>

      {/* Category Filter */}
      <div className="space-y-2">
        <Label htmlFor="category-filter">{t("filters.category")}</Label>
        <Select
          value={filters.category}
          onValueChange={(value) => updateFilter("category", value)}
        >
          <SelectTrigger id="category-filter" className="w-full">
            <SelectValue placeholder={t("filters.allCategories")} />
          </SelectTrigger>
          <SelectContent>
            {categories.map(({ _id, name }) => (
              <SelectItem key={_id} value={_id}>
                {name.en}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>

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
        <div className="flex flex-wrap gap-2">
          {allTags
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
      </div>
    </div>
  );
}
