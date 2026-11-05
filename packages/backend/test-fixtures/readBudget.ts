// What the reads that join image URLs are held to in tests. Convex allows 4,096 index ranges per
// function, but convex-test counts none for storage.getUrl, while a query's URL has to stay reactive
// to the file's row, so on a real backend each one probably costs a range too. That is inferred, not
// measured. So a test gives a read this budget: Convex's limit less a margin, less the URLs it asks
// for, and convex-test throws if its ranges don't fit in what is left.
const CONVEX_RANGE_LIMIT = 4096;
const MARGIN = 0.1;

export const rangesLeftAfterUrls = (urls: number): number =>
  Math.floor(CONVEX_RANGE_LIMIT * (1 - MARGIN)) - urls;
