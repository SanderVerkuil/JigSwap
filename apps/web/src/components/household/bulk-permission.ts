// Pure selection/filter logic for the household page's bulk permission editor.

export type HouseholdPermission = "manage" | "view";
export type PermissionFilter = "all" | HouseholdPermission;

interface PermissionRow {
  _id: string;
  householdPermission: HouseholdPermission;
}

export const filterByPermission = <T extends PermissionRow>(
  copies: readonly T[],
  filter: PermissionFilter,
): T[] =>
  filter === "all"
    ? [...copies]
    : copies.filter((copy) => copy.householdPermission === filter);

export const toggleSelected = (
  selected: ReadonlySet<string>,
  id: string,
): Set<string> => {
  const next = new Set(selected);
  if (next.has(id)) next.delete(id);
  else next.add(id);
  return next;
};

// "Select all" selects what the member can currently see (the filtered list).
export const selectAll = (visible: readonly PermissionRow[]): Set<string> =>
  new Set(visible.map((copy) => copy._id));

// The bulk action applies to the selected copies that are visible right now, so a copy hidden by
// the filter (or no longer in the list) is never changed by surprise.
export const selectedVisibleIds = (
  selected: ReadonlySet<string>,
  visible: readonly PermissionRow[],
): string[] =>
  visible.filter((copy) => selected.has(copy._id)).map((copy) => copy._id);
