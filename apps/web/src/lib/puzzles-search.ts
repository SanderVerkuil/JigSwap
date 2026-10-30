import {
  isDifficulty,
  type CatalogueFilters,
  type Difficulty,
} from "./catalogue-filters";

// Typed search params for the member catalogue (/puzzles). The term, every filter, the favourites
// toggle and the view mode live in the URL, so Back from a puzzle restores the same results and a
// filtered catalogue can be shared as a link. Defaults (grid view, no filter) are left out to keep
// the bare /puzzles URL clean. Malformed values are dropped, never thrown on.
export type PuzzlesSearch = {
  q?: string;
  brand?: string;
  minPieces?: number;
  maxPieces?: number;
  difficulty?: Difficulty;
  category?: string;
  tags?: string[];
  fav?: true;
  view?: "list";
};

const text = (value: unknown): string | undefined =>
  typeof value === "string" && value.trim() !== "" ? value.trim() : undefined;

const pieces = (value: unknown): number | undefined => {
  const n =
    typeof value === "number"
      ? value
      : typeof value === "string" && value.trim() !== ""
        ? Number(value)
        : Number.NaN;
  return Number.isFinite(n) && n >= 0 ? n : undefined;
};

const tagList = (value: unknown): string[] | undefined => {
  const raw = Array.isArray(value) ? value : [value];
  const tags = [
    ...new Set(raw.map(text).filter((tag): tag is string => !!tag)),
  ];
  return tags.length > 0 ? tags : undefined;
};

export function validatePuzzlesSearch(
  search: Record<string, unknown>,
): PuzzlesSearch {
  const result: PuzzlesSearch = {};
  const q = text(search.q);
  if (q) result.q = q;
  const brand = text(search.brand);
  if (brand) result.brand = brand;
  const minPieces = pieces(search.minPieces);
  if (minPieces !== undefined) result.minPieces = minPieces;
  const maxPieces = pieces(search.maxPieces);
  if (maxPieces !== undefined) result.maxPieces = maxPieces;
  if (isDifficulty(search.difficulty)) result.difficulty = search.difficulty;
  const category = text(search.category);
  if (category) result.category = category;
  const tags = tagList(search.tags);
  if (tags) result.tags = tags;
  if (search.fav === true || search.fav === "true") result.fav = true;
  if (search.view === "list") result.view = "list";
  return result;
}

/** The URL as the filter form's string values. */
export function filtersFromSearch(search: PuzzlesSearch): CatalogueFilters {
  return {
    searchTerm: search.q ?? "",
    brand: search.brand ?? "",
    minPieces: search.minPieces?.toString() ?? "",
    maxPieces: search.maxPieces?.toString() ?? "",
    difficulty: search.difficulty ?? "",
    category: search.category ?? "",
    tags: search.tags ?? [],
  };
}

/** The filter form's facets as URL params; an empty value clears its param. The term is not
 *  included: the search box writes it on its own schedule (after a pause in typing). */
export function facetSearch(
  filters: CatalogueFilters,
): Pick<
  PuzzlesSearch,
  "brand" | "minPieces" | "maxPieces" | "difficulty" | "category" | "tags"
> {
  return {
    brand: text(filters.brand),
    minPieces: pieces(filters.minPieces),
    maxPieces: pieces(filters.maxPieces),
    difficulty: isDifficulty(filters.difficulty)
      ? filters.difficulty
      : undefined,
    category: text(filters.category),
    tags: tagList(filters.tags),
  };
}
