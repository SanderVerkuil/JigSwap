// /profile search params. `?edit=profile` opens the Edit Profile form; `?edit=link` opens it with
// focus on the custom-link field. Anything else is dropped, so a bare /profile stays a clean URL.
export type ProfileEditTarget = "profile" | "link";

export function validateProfileSearch(search: Record<string, unknown>): {
  edit?: ProfileEditTarget;
} {
  return {
    edit:
      search.edit === "profile" || search.edit === "link"
        ? search.edit
        : undefined,
  };
}
