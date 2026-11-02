// The longest a solve's notes may be, for the web forms' maxLength. The domain enforces the same number
// (packages/domain/src/solving/domain/completion.ts, NotesTooLong);
// packages/backend/convex/libraryTextLimitsContract.test.ts fails when the two disagree.
export const MAX_SOLVE_NOTES_LENGTH = 5_000;
