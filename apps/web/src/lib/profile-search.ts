// /profile search params. `?edit=profile` opens the Edit Profile form; `?edit=link` opens it with
// focus on the custom-link field. Anything else is dropped, so a bare /profile stays a clean URL.
export type ProfileEditTarget = "profile" | "link";

/** The custom-link field in the Edit Profile form, the one `?edit=link` lands on. */
export const CUSTOM_LINK_FIELD_ID = "profile-slug";

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
