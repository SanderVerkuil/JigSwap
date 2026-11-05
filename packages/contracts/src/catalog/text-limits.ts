// The catalogue's text bounds for clients: the web forms use them as maxLength and as the tag
// list's limits, so a member never types what the server refuses. The domain enforces the same
// numbers (packages/domain/src/catalog/domain/catalog-text-limits.ts, TextTooLong, SEC-26);
// packages/backend/convex/catalogTextLimitsContract.test.ts fails when the two disagree.
export const CATALOG_TEXT_LIMITS = {
  title: 200,
  description: 5_000,
  brand: 100,
  publisher: 100,
  artist: 100,
  series: 100,
  modelNumber: 100,
  category: 64,
  tag: 50,
  comment: 2_000,
} as const;

// The most tags one puzzle may carry.
export const MAX_CATALOG_TAGS = 20;
