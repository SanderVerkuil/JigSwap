// Typed search params for /admin/users: `q` is the directory search, kept in the URL so opening a
// member and coming Back restores the filtered list (and so a link can open a search directly).
// Only a non-empty trimmed string survives.
export type AdminUsersSearch = { q?: string };

export function validateAdminUsersSearch(
  search: Record<string, unknown>,
): AdminUsersSearch {
  const q = typeof search.q === "string" ? search.q.trim() : "";
  return { q: q ? q : undefined };
}

// A whole email address ("local@domain", no spaces), which admin.listUsers looks up exactly
// instead of searching names. Mirrors EMAIL_SHAPED in packages/backend/convex/admin/listUsers.ts.
export function looksLikeEmail(term: string): boolean {
  return /^[^\s@]+@[^\s@]+$/.test(term);
}
