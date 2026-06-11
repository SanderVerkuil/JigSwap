// The grading of a physical Copy, matching the persisted `ownedPuzzles.condition` column
// 1:1 (no legacy translation needed). Ordered best→worst so a future condition timeline can
// reason about deterioration.
//   new_sealed -> factory sealed, never opened
//   like_new   -> opened but perfect
//   good / fair / poor -> increasing wear
export type Condition = "new_sealed" | "like_new" | "good" | "fair" | "poor";

export const CONDITIONS: readonly Condition[] = [
  "new_sealed",
  "like_new",
  "good",
  "fair",
  "poor",
];

export const isCondition = (value: string): value is Condition =>
  (CONDITIONS as readonly string[]).includes(value);
