// The catalogue's text bounds, mirrored from the domain
// (packages/domain/src/catalog/domain/catalog-text-limits.ts), which refuses longer text with
// TextTooLong. The forms use them as maxLength so a member never types what the server refuses.
// Keep the numbers in sync with the domain.
export const CATALOG_TEXT_LIMITS = {
  title: 200,
  description: 5_000,
  brand: 100,
  publisher: 100,
  artist: 100,
  series: 100,
  modelNumber: 100,
  tag: 50,
  comment: 2_000,
} as const;

// The most tags one puzzle may carry.
export const MAX_CATALOG_TAGS = 20;
