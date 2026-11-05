// Typed search params for /admin/puzzles, kept in the URL so opening a definition and coming Back
// (or a reload, or a shared link) restores the filtered list:
// - `status`: one moderation status (absent = every status);
// - `q`: the search term (title, brand, publisher, artist, series, tags).
// Anything unknown or blank is dropped.
export const ADMIN_PUZZLE_STATUSES = [
  "pending",
  "approved",
  "rejected",
  "disabled",
] as const;
export type AdminPuzzleStatus = (typeof ADMIN_PUZZLE_STATUSES)[number];

export type AdminPuzzlesSearch = { status?: AdminPuzzleStatus; q?: string };

export function validateAdminPuzzlesSearch(
  search: Record<string, unknown>,
): AdminPuzzlesSearch {
  const q = typeof search.q === "string" ? search.q.trim() : "";
  return {
    status: (ADMIN_PUZZLE_STATUSES as readonly unknown[]).includes(
      search.status,
    )
      ? (search.status as AdminPuzzleStatus)
      : undefined,
    q: q ? q : undefined,
  };
}
