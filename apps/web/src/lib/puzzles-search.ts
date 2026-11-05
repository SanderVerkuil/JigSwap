import {
  isDifficulty,
  type CatalogueFilters,
  type Difficulty,
} from "./catalogue-filters";
import { piecesParam, textParam } from "./search-params";

// Typed search params for the member catalogue (/puzzles). The term, every filter, the favourites
// toggle and the view mode live in the URL, so Back from a puzzle restores the same results and a
// filtered catalogue can be shared as a link. Defaults (grid view, no filter) are undefined, which
// keeps the bare /puzzles URL clean. A malformed value reads as undefined, and every known key is
// returned so that this replaces the raw value (see lib/search-params).
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

const tagList = (value: unknown): string[] | undefined => {
  const raw = Array.isArray(value) ? value : [value];
  const tags = [
    ...new Set(raw.map(textParam).filter((tag): tag is string => !!tag)),
  ];
  return tags.length > 0 ? tags : undefined;
};

export function validatePuzzlesSearch(
  search: Record<string, unknown>,
): PuzzlesSearch {
  return {
    q: textParam(search.q),
    brand: textParam(search.brand),
    minPieces: piecesParam(search.minPieces),
    maxPieces: piecesParam(search.maxPieces),
    difficulty: isDifficulty(search.difficulty) ? search.difficulty : undefined,
    category: textParam(search.category),
    tags: tagList(search.tags),
    fav: search.fav === true || search.fav === "true" ? true : undefined,
    view: search.view === "list" ? "list" : undefined,
  };
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
    brand: textParam(filters.brand),
    minPieces: piecesParam(filters.minPieces),
    maxPieces: piecesParam(filters.maxPieces),
    difficulty: isDifficulty(filters.difficulty)
      ? filters.difficulty
      : undefined,
    category: textParam(filters.category),
    tags: tagList(filters.tags),
  };
}
