// Typed search params for the public /catalog page: `q` (search term), `brand`
// and `pieces` (a piece-count bucket). Keeping the filters in the URL lets Back
// from a puzzle restore them and makes a filtered view shareable. Anything
// unknown, blank or of the wrong type is dropped, so a hand-edited URL shows
// the unfiltered catalogue instead of failing.

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
};

export function isPieceBucket(value: unknown): value is PieceBucket {
  return typeof value === "string" && Object.hasOwn(PIECE_BUCKETS, value);
}

// The search term as the URL stores it: trimmed, and absent when blank. The
// page applies the same rule to what is typed, so it can tell its own URL
// writes from a URL change made elsewhere (Back, a "Catalogue" link).
export function normalizeCatalogQuery(value: unknown): string | undefined {
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
