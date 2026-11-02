// The library's text bounds for clients: the web forms use them as maxLength, so a member never
// types what the server refuses. The domain enforces the same numbers
// (packages/domain/src/library/domain/text-limits.ts, TextTooLong);
// packages/backend/convex/libraryTextLimitsContract.test.ts fails when the two disagree.
export const LIBRARY_TEXT_LIMITS = {
  collectionName: 100,
  collectionDescription: 1_000,
  collectionNotes: 2_000,
  categoryName: 100,
  categoryDescription: 1_000,
  color: 32,
  icon: 32,
  copyNotes: 5_000,
} as const;
