import { catalogueSearchKey, foldForSearch } from "./catalogue-search";

// The member catalogue's (/puzzles) filters: the form values the toolbar and the Filters panel
// edit, the catalog.search arguments they turn into, and the same predicate on the client for the
// favourites view (which reads the member's whole favourites list instead of the paged search).

export const DIFFICULTIES = ["easy", "medium", "hard", "expert"] as const;
export type Difficulty = (typeof DIFFICULTIES)[number];

export const isDifficulty = (value: unknown): value is Difficulty =>
  (DIFFICULTIES as readonly unknown[]).includes(value);

/** Form values: strings as the inputs and selects hold them, "" meaning "not set". */
export interface CatalogueFilters {
  searchTerm: string;
  brand: string;
  minPieces: string;
  maxPieces: string;
  difficulty: string;
  category: string;
  tags: string[];
}

export const EMPTY_CATALOGUE_FILTERS: CatalogueFilters = {
  searchTerm: "",
  brand: "",
  minPieces: "",
  maxPieces: "",
  difficulty: "",
  category: "",
  tags: [],
};

/** The catalog.search facet arguments. Only set keys are present. */
export interface CatalogueSearchArgs {
  searchTerm?: string;
  brand?: string;
  pieceMin?: number;
  pieceMax?: number;
  difficulty?: Difficulty;
  category?: string;
  tags?: string[];
}

const pieceBound = (value: string): number | undefined => {
  const trimmed = value.trim();
  if (trimmed === "") return undefined;
  const bound = Number(trimmed);
  return Number.isFinite(bound) ? bound : undefined;
};

// Only filters that are set become arguments, so an unfiltered catalogue sends exactly what the
// add-copy picker sends, and a value the server would reject (a non-number, an unknown difficulty)
// is dropped rather than failing the query.
export function catalogueSearchArgs(
  filters: CatalogueFilters,
): CatalogueSearchArgs {
  const args: CatalogueSearchArgs = {};
  const term = catalogueSearchKey(filters.searchTerm);
  if (term) args.searchTerm = term;
  if (filters.brand) args.brand = filters.brand;
  const lower = pieceBound(filters.minPieces);
  const upper = pieceBound(filters.maxPieces);
  // Bounds typed the wrong way round still mean a range, not "no puzzles".
  const inverted = lower !== undefined && upper !== undefined && lower > upper;
  const pieceMin = inverted ? upper : lower;
  const pieceMax = inverted ? lower : upper;
  if (pieceMin !== undefined) args.pieceMin = pieceMin;
  if (pieceMax !== undefined) args.pieceMax = pieceMax;
  if (isDifficulty(filters.difficulty)) args.difficulty = filters.difficulty;
  if (filters.category) args.category = filters.category;
  if (filters.tags.length > 0) args.tags = filters.tags;
  return args;
}

export function hasActiveCatalogueFilters(filters: CatalogueFilters): boolean {
  return Object.values(filters).some((value) =>
    Array.isArray(value) ? value.length > 0 : value.trim() !== "",
  );
}

/** How many facets narrow the results: a piece range counts once, each tag on its own. The term
 *  is not one: it shows in the toolbar's box. */
export function activeFacetCount(filters: CatalogueFilters): number {
  return (
    [
      filters.brand,
      filters.minPieces || filters.maxPieces,
      filters.difficulty,
      filters.category,
    ].filter((value) => value.trim() !== "").length + filters.tags.length
  );
}

interface FilterablePuzzle {
  title: string;
  brand?: string;
  pieceCount: number;
  difficulty?: string;
  category?: string;
  tags?: string[];
}

// The client-side twin of catalog.search's facets. The term can't use the search index here, so
// every word of it must appear in the title, brand or tags (the summary fields the index covers),
// accents aside, as on the server.
export function matchesCatalogueSearch(
  puzzle: FilterablePuzzle,
  args: CatalogueSearchArgs,
): boolean {
  const haystack = foldForSearch(
    [puzzle.title, puzzle.brand ?? "", ...(puzzle.tags ?? [])].join(" "),
  );
  return (
    (args.searchTerm === undefined ||
      foldForSearch(args.searchTerm)
        .split(" ")
        .every((word) => haystack.includes(word))) &&
    (args.brand === undefined || puzzle.brand === args.brand) &&
    (args.pieceMin === undefined || puzzle.pieceCount >= args.pieceMin) &&
    (args.pieceMax === undefined || puzzle.pieceCount <= args.pieceMax) &&
    (args.difficulty === undefined || puzzle.difficulty === args.difficulty) &&
    (args.category === undefined || puzzle.category === args.category) &&
    (args.tags === undefined ||
      args.tags.some((tag) => puzzle.tags?.includes(tag) ?? false))
  );
}

// The catalogue lists approved puzzles only; a favourite that is no longer approved stays out of
// it, as it did when favourites were picked from the loaded catalogue pages.
export function favouritesInCatalogue<
  T extends FilterablePuzzle & { status: string },
>(favourites: T[], args: CatalogueSearchArgs): T[] {
  return favourites.filter(
    (puzzle) =>
      puzzle.status === "approved" && matchesCatalogueSearch(puzzle, args),
  );
}

export type CatalogueEmptyState =
  "searched" | "filtered" | "noFavourites" | "emptyCatalogue";

// Which "nothing here" message an exhausted, empty catalogue shows. A set filter is blamed; a term
// is named as a search only when it is all that narrows the catalogue (in favourites it searched
// the favourites alone, so it is blamed like a filter); favourites on its own means there are none
// yet; with nothing set, the catalogue itself is empty.
export function catalogueEmptyState({
  favoritesOnly,
  filters,
}: {
  favoritesOnly: boolean;
  filters: CatalogueFilters;
}): CatalogueEmptyState {
  if (activeFacetCount(filters) > 0) return "filtered";
  if (filters.searchTerm.trim() !== "")
    return favoritesOnly ? "filtered" : "searched";
  return favoritesOnly ? "noFavourites" : "emptyCatalogue";
}
