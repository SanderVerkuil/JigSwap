// Typed search params for the public /catalog page: `q` (search term), `brand`,
// `pieces` (a piece-count bucket) and `pages` (how many pages "Load more" has
// opened). Keeping them in the URL lets Back from a puzzle restore them and makes
// a filtered view shareable. Anything unknown, blank or unusable is dropped, so a
// hand-edited URL shows the unfiltered catalogue instead of failing.

// Piece-count buckets from the spec: <500 / 500 / 1000 / 1500+.
export const PIECE_BUCKETS = {
  lt500: { pieceMax: 499 },
  b500: { pieceMin: 500, pieceMax: 999 },
  b1000: { pieceMin: 1000, pieceMax: 1499 },
  b1500: { pieceMin: 1500 },
} as const;
export type PieceBucket = keyof typeof PIECE_BUCKETS;

export type PublicCatalogSearch = {
  q?: string;
  brand?: string;
  pieces?: PieceBucket;
  pages?: number;
};

// The most pages one URL can ask for: the loader reads them one after the other
// before the page renders, on the server for a shared link.
export const MAX_CATALOG_PAGES = 25;

// Absent for one page, which is what a bare URL shows anyway.
function validatePageCount(value: unknown): number | undefined {
  if (typeof value !== "number" || !Number.isInteger(value) || value < 2) {
    return undefined;
  }
  return Math.min(value, MAX_CATALOG_PAGES);
}

export function isPieceBucket(value: unknown): value is PieceBucket {
  return typeof value === "string" && Object.hasOwn(PIECE_BUCKETS, value);
}

// The search term as the URL stores it: trimmed, and absent when blank. The
// page applies the same rule to what is typed, so it can tell its own URL
// writes from a URL change made elsewhere (Back, a "Catalogue" link). The router
// parses `?q=1000` into a number and `?q=true` into a boolean before this runs, so
// those count as the text they were in the link.
export function normalizeCatalogQuery(value: unknown): string | undefined {
  if (typeof value === "number" || typeof value === "boolean") {
    return String(value);
  }
  if (typeof value !== "string") return undefined;
  const trimmed = value.trim();
  return trimmed ? trimmed : undefined;
}

export function validatePublicCatalogSearch(
  search: Record<string, unknown>,
): PublicCatalogSearch {
  return {
    q: normalizeCatalogQuery(search.q),
    brand: normalizeCatalogQuery(search.brand),
    pieces: isPieceBucket(search.pieces) ? search.pieces : undefined,
    pages: validatePageCount(search.pages),
  };
}

// The publicBrowse filter args for a search. Absent filters are omitted, not
// sent as undefined, so the loader's prefetch and the page's query share one
// cache entry.
export function publicCatalogFilterArgs({
  q,
  brand,
  pieces,
}: PublicCatalogSearch): {
  searchTerm?: string;
  brand?: string;
  pieceMin?: number;
  pieceMax?: number;
} {
  return {
    ...(q ? { searchTerm: q } : {}),
    ...(brand ? { brand } : {}),
    ...(pieces ? PIECE_BUCKETS[pieces] : {}),
  };
}
