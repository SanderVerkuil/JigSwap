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

// Convex pagination options with `numItems` clamped to [1, max] (a non-finite one asks for a full
// page). Every other option (cursor, endCursor, maximumRowsRead, …) passes through untouched, so
// reactive pagination keeps its page boundaries.
export const clampPaginationOpts = <T extends { numItems: number }>(
  opts: T,
  max: number,
): T => ({
  ...opts,
  numItems: clampLimit(opts.numItems, { fallback: max, max }),
});
