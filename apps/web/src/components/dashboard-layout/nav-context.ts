// Typed parser for the `?from=` navigation-context search param (UX: breadcrumbs are
// canonical by default and contextual ONLY when the arriving link carries explicit
// context — see the copies page). Currently only collections; extend the union as
// new contexts appear.
export interface NavContext {
  kind: "collection";
  id: string;
}

export const parseNavContext = (
  value: string | undefined,
): NavContext | null => {
  if (!value) return null;
  const [kind, id] = value.split(":", 2);
  if (kind === "collection" && id) return { kind, id };
  return null;
};
