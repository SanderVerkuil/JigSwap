import { isDifficulty, type Difficulty } from "./catalogue-filters";
import { piecesParam, textParam } from "./search-params";

// Typed search params for /browse. `puzzle` narrows Browse to copies of one catalogue definition
// (its Convex _id), so "Find a copy to swap" links are shareable and survive back/forward. Only a
// non-empty string survives; the backend validates the id itself and returns an empty page for a
// malformed one. The term, every filter and the view mode live in the URL too, so Back from a copy
// restores the same results and a filtered Browse can be shared as a link. Defaults (grid view, no
// filter) are undefined, which keeps the bare /browse URL clean. A malformed value reads as
// undefined, and every known key is returned so that this replaces the raw value (see
// lib/search-params).

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

const channels = (value: unknown): AvailabilityFlag[] | undefined => {
  const raw = Array.isArray(value) ? value : [value];
  const list = [...new Set(raw.filter(isAvailabilityFlag))];
  return list.length > 0 ? list : undefined;
};

export function validateBrowseSearch(
  search: Record<string, unknown>,
): BrowseSearch {
  return {
    // Unlike the text params, not read as text: an id is never a bare number.
    puzzle:
      typeof search.puzzle === "string" ? textParam(search.puzzle) : undefined,
    q: textParam(search.q),
    category: textParam(search.category),
    condition: isCondition(search.condition) ? search.condition : undefined,
    difficulty: isDifficulty(search.difficulty) ? search.difficulty : undefined,
    minPieces: piecesParam(search.minPieces),
    maxPieces: piecesParam(search.maxPieces),
    avail: channels(search.avail),
    view: search.view === "list" ? "list" : undefined,
  };
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
    category: textParam(filters.category),
    condition: isCondition(filters.condition) ? filters.condition : undefined,
    difficulty: isDifficulty(filters.difficulty)
      ? filters.difficulty
      : undefined,
    minPieces: piecesParam(filters.minPieces),
    maxPieces: piecesParam(filters.maxPieces),
    avail: channels(filters.availability),
  };
}

/** Which "nothing here" message an empty Browse shows: "filtered" (the text or a filter is set,
 *  so blame those), "puzzleNotOffered" (only ?puzzle narrows it: nobody offers that puzzle) or
 *  "noOffers" (nothing narrows it: nobody offers anything this member can see). */
export type BrowseEmptyState = "filtered" | "puzzleNotOffered" | "noOffers";

// The conditions a member sets in the query builder. Named, not "everything but ?puzzle and the
// view": the search also holds params no validator knows, such as utm_source (see lib/search-params).
const CONDITION_PARAMS = [
  "q",
  "category",
  "condition",
  "difficulty",
  "minPieces",
  "maxPieces",
  "avail",
] as const;

export function browseEmptyState(search: BrowseSearch): BrowseEmptyState {
  if (CONDITION_PARAMS.some((param) => search[param] !== undefined)) {
    return "filtered";
  }
  return search.puzzle ? "puzzleNotOffered" : "noOffers";
}

/** The search with the text and every filter cleared; ?puzzle and the view mode stay. */
export const withoutBrowseConditions = ({
  puzzle,
  view,
}: BrowseSearch): BrowseSearch => ({ puzzle, view });
