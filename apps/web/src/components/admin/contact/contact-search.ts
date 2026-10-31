// Typed search params for /admin/contact: `status` is the inbox filter, kept in the URL so a
// reload, Back or a shared link keeps it. New is the default and stays out of the URL (absent =
// new); anything unknown falls back to it.
export const CONTACT_FILTERS = ["new", "handled", "all"] as const;
export type ContactFilter = (typeof CONTACT_FILTERS)[number];

export type ContactSearch = { status?: Exclude<ContactFilter, "new"> };

export function validateContactSearch(
  search: Record<string, unknown>,
): ContactSearch {
  const status = search.status;
  return {
    status: status === "handled" || status === "all" ? status : undefined,
  };
}
