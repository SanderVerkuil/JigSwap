/**
 * The Convex id of the puzzle definition just submitted, found by the domain id the submit
 * returned among the member's own not-yet-approved submissions (catalog.myContributedPuzzles).
 * Null when it is not there: an admin's submission is approved at once, so it never is.
 */
export function submittedPuzzleId(
  mine: ReadonlyArray<{ _id: string; aggregateId?: string }>,
  aggregateId: string,
): string | null {
  return mine.find((p) => p.aggregateId === aggregateId)?._id ?? null;
}
