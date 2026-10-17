// Typed search params for /browse. `puzzle` narrows Browse to copies of one catalogue definition
// (its Convex _id), so "Find a copy to swap" links are shareable and survive back/forward. Only a
// non-empty string survives; the backend validates the id itself and returns an empty page for a
// malformed one.
export type BrowseSearch = { puzzle?: string };

export function validateBrowseSearch(
  search: Record<string, unknown>,
): BrowseSearch {
  const puzzle =
    typeof search.puzzle === "string" ? search.puzzle.trim() : undefined;
  return { puzzle: puzzle ? puzzle : undefined };
}
