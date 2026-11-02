import type { OwnedCopyView } from "@jigswap/contracts";

// What My Puzzles (/my-puzzles) shows: the view, a status pill, whose copies, a free-text search
// and a sort. They live in the URL so Back from a copy, a reload or a shared link keeps them; the
// defaults are left out so a bare /my-puzzles stays bare.

// Status pills mapped onto what the data carries: the copy's offer flags, the open loans of copies
// the member lent out (or may manage), and the member's solve log for the progress states.
export const MY_PUZZLES_STATUSES = [
  "all",
  "available",
  "forTrade",
  "forLend",
  "lentOut",
  "inProgress",
  "completed",
] as const;
export type MyPuzzlesStatus = (typeof MY_PUZZLES_STATUSES)[number];

// Whose copies to show when the viewer is in a household: everything, only their own, or only
// the ones that come through a household member.
export const MY_PUZZLES_OWNERS = ["all", "mine", "household"] as const;
export type MyPuzzlesOwner = (typeof MY_PUZZLES_OWNERS)[number];

export const MY_PUZZLES_SORTS = ["recent", "title", "pieces"] as const;
export type MyPuzzlesSort = (typeof MY_PUZZLES_SORTS)[number];

export interface MyPuzzlesSearch {
  view?: "list";
  status?: Exclude<MyPuzzlesStatus, "all">;
  owner?: Exclude<MyPuzzlesOwner, "all">;
  q?: string;
  sort?: Exclude<MyPuzzlesSort, "recent">;
}

export interface MyPuzzlesFilters {
  status: MyPuzzlesStatus;
  owner: MyPuzzlesOwner;
  q: string;
  sort: MyPuzzlesSort;
}

export const MAX_SEARCH_LENGTH = 100;

// A known value other than the default, else undefined (the default is never written to the URL).
const oneOf = <T extends string, D extends T>(
  values: readonly T[],
  value: unknown,
  fallback: D,
): Exclude<T, D> | undefined =>
  values.includes(value as T) && value !== fallback
    ? (value as Exclude<T, D>)
    : undefined;

export function validateMyPuzzlesSearch(
  search: Record<string, unknown>,
): MyPuzzlesSearch {
  // The router JSON-parses search values, so a typed ?q=1000 arrives as a number.
  const rawQ =
    typeof search.q === "string" || typeof search.q === "number"
      ? String(search.q).trim().slice(0, MAX_SEARCH_LENGTH)
      : "";
  const result: MyPuzzlesSearch = {
    view: search.view === "list" ? "list" : undefined,
    status: oneOf(MY_PUZZLES_STATUSES, search.status, "all"),
    owner: oneOf(MY_PUZZLES_OWNERS, search.owner, "all"),
    q: rawQ || undefined,
    sort: oneOf(MY_PUZZLES_SORTS, search.sort, "recent"),
  };
  // Leave unset keys out entirely, so the URL carries only what differs from the defaults.
  return Object.fromEntries(
    Object.entries(result).filter(([, value]) => value !== undefined),
  ) as MyPuzzlesSearch;
}

export function filtersFromSearch(search: MyPuzzlesSearch): MyPuzzlesFilters {
  return {
    status: search.status ?? "all",
    owner: search.owner ?? "all",
    q: search.q ?? "",
    sort: search.sort ?? "recent",
  };
}

// Whether this view needs the whole library to answer: a search, a sort other than newest first and
// the status pills all do. Only whose copies it is can be read a window at a time.
export const viewNeedsWholeLibrary = (filters: MyPuzzlesFilters): boolean =>
  filters.q !== "" || filters.status !== "all" || filters.sort !== "recent";

// What filtering and sorting read: a lean library.myLibraryIndex row, or a full row.
type LibraryCopy = Pick<
  OwnedCopyView,
  "_id" | "availability" | "createdAt" | "snapshot"
> & {
  puzzle?: {
    title: string;
    brand?: string;
    pieceCount: number;
    tags?: string[];
  } | null;
};

// Lowercased, accents stripped, so "creme" finds "Crème" and "Tirol" finds "tïrol".
const fold = (text: string): string =>
  text
    .normalize("NFD")
    .replace(/\p{Diacritic}/gu, "")
    .toLowerCase();

const titleOf = (copy: LibraryCopy): string =>
  copy.puzzle?.title ?? copy.snapshot?.title ?? "";

const piecesOf = (copy: LibraryCopy): number | undefined =>
  copy.puzzle?.pieceCount ?? copy.snapshot?.pieceCount;

// The text a search looks through: title, brand and tags.
const haystackOf = (copy: LibraryCopy): string =>
  fold(
    [
      titleOf(copy),
      copy.puzzle?.brand ?? copy.snapshot?.brand ?? "",
      ...(copy.puzzle?.tags ?? []),
    ].join("\n"),
  );

// Every word must appear somewhere in the title, brand or tags; a leading "#" (how cards show tags)
// is ignored.
const matchesSearch = (copy: LibraryCopy, q: string): boolean => {
  const words = fold(q)
    .split(/\s+/)
    .map((word) => word.replace(/^#+/, ""))
    .filter(Boolean);
  if (words.length === 0) return true;
  const haystack = haystackOf(copy);
  return words.every((word) => haystack.includes(word));
};

export interface CopyFilterContext {
  /** Whether the copy reaches the viewer through a household member (not their own). */
  viaHousehold: (copyId: string) => boolean;
  /** The viewer's solve state for the copy, if any. */
  solveState: (
    copyId: string,
  ) => { inProgress: boolean; completed: boolean } | undefined;
  /**
   * Whether the copy is out with a borrower right now: an open loan in lending.lentOut (the viewer's
   * own copies, plus housemates' copies the viewer may manage).
   */
  lentOut: (copyId: string) => boolean;
  /** The UI locale, for sorting titles. */
  locale: string;
}

const matchesStatus = (
  copy: LibraryCopy,
  status: MyPuzzlesStatus,
  context: CopyFilterContext,
): boolean => {
  const { forTrade, forLend, forSale } = copy.availability;
  switch (status) {
    case "all":
      return true;
    case "available":
      return forTrade || forLend || forSale;
    case "forTrade":
      return forTrade;
    case "forLend":
      return forLend;
    case "lentOut":
      return context.lentOut(copy._id);
    case "inProgress":
      return context.solveState(copy._id)?.inProgress ?? false;
    case "completed":
      return context.solveState(copy._id)?.completed ?? false;
  }
};

const matchesOwner = (
  copy: LibraryCopy,
  owner: MyPuzzlesOwner,
  context: CopyFilterContext,
): boolean => {
  if (owner === "all") return true;
  const viaHousehold = context.viaHousehold(copy._id);
  return owner === "household" ? viaHousehold : !viaHousehold;
};

// The copies My Puzzles lists for the given filters, in the chosen order. Returns a new array.
export function filterAndSortCopies<T extends LibraryCopy>(
  copies: readonly T[],
  filters: MyPuzzlesFilters,
  context: CopyFilterContext,
): T[] {
  const collator = new Intl.Collator(context.locale, {
    sensitivity: "base",
    numeric: true,
  });
  const byTitle = (a: T, b: T) => collator.compare(titleOf(a), titleOf(b));
  const byRecent = (a: T, b: T) => b.createdAt - a.createdAt;
  // Fewest pieces first; a copy without a piece count goes last.
  const byPieces = (a: T, b: T) =>
    (piecesOf(a) ?? Number.POSITIVE_INFINITY) -
      (piecesOf(b) ?? Number.POSITIVE_INFINITY) || byTitle(a, b);

  const compare =
    filters.sort === "title"
      ? (a: T, b: T) => byTitle(a, b) || byRecent(a, b)
      : filters.sort === "pieces"
        ? byPieces
        : byRecent;

  return copies
    .filter(
      (copy) =>
        matchesOwner(copy, filters.owner, context) &&
        matchesStatus(copy, filters.status, context) &&
        matchesSearch(copy, filters.q),
    )
    .sort(compare);
}
