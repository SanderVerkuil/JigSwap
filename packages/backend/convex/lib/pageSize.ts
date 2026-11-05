import type { PaginationOptions } from "convex/server";

// Server-side bounds for client-supplied page sizes (SEC-49). Every public function is directly
// callable with any arguments, so a `limit` or `numItems` from the client is a request, never a
// promise: each public read clamps it here before it reaches `.take()`, `.paginate()` or a slice,
// so one call can never be asked to read and join an unbounded number of rows.

// A missing or non-finite size (undefined, NaN, ±Infinity) gets the query's default; anything else
// is floored into [1, max].
export const clampLimit = (
  requested: number | undefined,
  { fallback, max }: { fallback: number; max: number },
): number =>
  requested === undefined || !Number.isFinite(requested)
    ? fallback
    : Math.min(max, Math.max(1, Math.floor(requested)));

// An offset into an in-memory result: a missing, non-finite or negative one starts at the top.
export const clampOffset = (requested: number | undefined): number =>
  requested === undefined || !Number.isFinite(requested)
    ? 0
    : Math.max(0, Math.floor(requested));

// How many pages' worth of rows one pinned page (a page with an endCursor) may read.
export const PINNED_PAGE_READ_FACTOR = 4;

// Convex pagination options with `numItems` clamped to [1, max] (a non-finite one asks for a full
// page). An `endCursor` overrides numItems: the read runs up to it, however far away it is. The
// reactive paging hooks need that to keep a page's boundaries (convex-helpers pins every page it
// has moved past, Convex's own hook pins the two halves of a split), and a cursor can't be told
// apart from one a client walked to, so the pin stays but the read is bounded: past
// max * PINNED_PAGE_READ_FACTOR rows it stops and answers SplitRequired with a splitCursor, which
// both hooks act on. A client's own smaller maximumRowsRead stands; a larger or non-finite one
// doesn't. Reads go through paginateBounded, which also keeps the split from losing rows.
export const clampPaginationOpts = <
  T extends {
    numItems: number;
    endCursor?: string | null;
    maximumRowsRead?: number;
  },
>(
  opts: T,
  max: number,
): T => {
  const numItems = clampLimit(opts.numItems, { fallback: max, max });
  if (!opts.endCursor) return { ...opts, numItems };
  const bound = max * PINNED_PAGE_READ_FACTOR;
  return {
    ...opts,
    numItems,
    maximumRowsRead: clampLimit(opts.maximumRowsRead, {
      fallback: bound,
      max: bound,
    }),
  };
};

// The same for a read no client pins, so numItems is the whole bound and an endCursor is dropped:
// reads that are walked by hand with `cursor` alone, and search index reads, for which Convex
// doesn't enforce maximumRowsRead (a search page that small never asks Convex's hook to split it).
export const clampUnpinnedPaginationOpts = <
  T extends { numItems: number; endCursor?: string | null },
>(
  opts: T,
  max: number,
): T => ({
  ...opts,
  numItems: clampLimit(opts.numItems, { fallback: max, max }),
  endCursor: undefined,
});

// A page cut by the bound answers with the cursor where the read stopped, but it still has to cover
// everything up to its pin: the hooks split it into (cursor, splitCursor] and
// (splitCursor, continueCursor], and the rows between the cut and the pin would belong to neither
// half. A read that filters reaches the bound with no sign of trouble, because filtered rows count
// against it: 20 matches can honestly span more rows than four pages.
export const keepPinnedEnd = <
  R extends { continueCursor: string; pageStatus?: string | null },
>(
  result: R,
  opts: { endCursor?: string | null },
): R =>
  opts.endCursor && result.pageStatus === "SplitRequired"
    ? { ...result, continueCursor: opts.endCursor }
    : result;

// The one way to read a page the paging hooks may pin, from an index or a stream, filtering or not:
// the client's options are clamped, a pinned read is bounded, and splitting a page that hit the bound
// loses no row. convex/pageReadsGoThroughTheHelper.test.ts fails on a read that goes around it.
export const paginateBounded = async <
  R extends { continueCursor: string; pageStatus?: string | null },
>(
  read: { paginate: (opts: PaginationOptions) => Promise<R> },
  opts: PaginationOptions,
  max: number,
): Promise<R> => {
  const clamped = clampPaginationOpts(opts, max);
  return keepPinnedEnd(await read.paginate(clamped), clamped);
};
