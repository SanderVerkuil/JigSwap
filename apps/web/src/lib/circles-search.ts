// /circles search params. `?invite=<id>` (the circle_invite_received deep link) highlights that
// invitation; `?create=1` (the ⌘K "Create a Circle" quick action) opens the create dialog. Anything
// else is dropped.
export function validateCirclesSearch(search: Record<string, unknown>): {
  invite?: string;
  create?: true;
} {
  const create = search.create;
  return {
    invite: typeof search.invite === "string" ? search.invite : undefined,
    // The router parses ?create=1 as the number 1; accept the string and boolean forms too.
    create:
      create === 1 || create === "1" || create === true || create === "true"
        ? true
        : undefined,
  };
}
