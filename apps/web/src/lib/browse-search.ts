import { isDifficulty, type Difficulty } from "./catalogue-filters";

// Typed search params for /browse. `puzzle` narrows Browse to copies of one catalogue definition
// (its Convex _id), so "Find a copy to swap" links are shareable and survive back/forward. Only a
// non-empty string survives; the backend validates the id itself and returns an empty page for a
// malformed one. The term, every filter and the view mode live in the URL too, so Back from a copy
// restores the same results and a filtered Browse can be shared as a link. Defaults (grid view, no
// filter) are left out to keep the bare /browse URL clean. Malformed values are dropped, never
// thrown on.

export const CONDITIONS = [
  "new_sealed",
  "like_new",
  "good",
  "fair",
  "poor",
] as const;
export type Condition = (typeof CONDITIONS)[number];
export const AVAILABILITY_FLAGS = ["forTrade", "forLend", "forSale"] as const;
export type AvailabilityFlag = (typeof AVAILABILITY_FLAGS)[number];

const isCondition = (value: unknown): value is Condition =>
  (CONDITIONS as readonly unknown[]).includes(value);
const isAvailabilityFlag = (value: unknown): value is AvailabilityFlag =>
  (AVAILABILITY_FLAGS as readonly unknown[]).includes(value);

export type BrowseSearch = {
  puzzle?: string;
  q?: string;
  category?: string;
  condition?: Condition;
  difficulty?: Difficulty;
  minPieces?: number;
  maxPieces?: number;
  avail?: AvailabilityFlag[];
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

const channels = (value: unknown): AvailabilityFlag[] | undefined => {
  const raw = Array.isArray(value) ? value : [value];
  const list = [...new Set(raw.filter(isAvailabilityFlag))];
  return list.length > 0 ? list : undefined;
};

export function validateBrowseSearch(
  search: Record<string, unknown>,
): BrowseSearch {
  const result: BrowseSearch = {};
  const puzzle = text(search.puzzle);
  if (puzzle) result.puzzle = puzzle;
  const q = text(search.q);
  if (q) result.q = q;
  const category = text(search.category);
  if (category) result.category = category;
  if (isCondition(search.condition)) result.condition = search.condition;
  if (isDifficulty(search.difficulty)) result.difficulty = search.difficulty;
  const minPieces = pieces(search.minPieces);
  if (minPieces !== undefined) result.minPieces = minPieces;
  const maxPieces = pieces(search.maxPieces);
  if (maxPieces !== undefined) result.maxPieces = maxPieces;
  const avail = channels(search.avail);
  if (avail) result.avail = avail;
  if (search.view === "list") result.view = "list";
  return result;
}

/** Browse's filter form values (the query builder's conditions other than the free text), with
 *  "" meaning "not set". */
export interface BrowseFilters {
  category: string;
  condition: Condition | "";
  difficulty: Difficulty | "";
  minPieces: string;
  maxPieces: string;
  availability: AvailabilityFlag[];
}

/** The URL as the builder's form values. */
export function browseFiltersFromSearch(search: BrowseSearch): BrowseFilters {
  return {
    category: search.category ?? "",
    condition: search.condition ?? "",
    difficulty: search.difficulty ?? "",
    minPieces: search.minPieces?.toString() ?? "",
    maxPieces: search.maxPieces?.toString() ?? "",
    availability: search.avail ?? [],
  };
}

/** The builder's form values as URL params; an empty value clears its param. The term is not
 *  included: the Text field writes it on its own schedule (after a pause in typing). */
export function browseSearchFromFilters(
  filters: BrowseFilters,
): Pick<
  BrowseSearch,
  "category" | "condition" | "difficulty" | "minPieces" | "maxPieces" | "avail"
> {
  return {
    category: text(filters.category),
    condition: isCondition(filters.condition) ? filters.condition : undefined,
    difficulty: isDifficulty(filters.difficulty)
      ? filters.difficulty
      : undefined,
    minPieces: pieces(filters.minPieces),
    maxPieces: pieces(filters.maxPieces),
    avail: channels(filters.availability),
  };
}
