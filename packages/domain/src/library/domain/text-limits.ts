import { err, ok, Result } from "../../shared-kernel";
import { LibraryError } from "./errors";

// Bounds on the free text a member's library holds. A collection, a category or a copy's notes are
// stored and read back as written (public collections by every member who opens the profile), so
// none may grow to the size of a document. Checked when text is written, never on rehydrate, so a
// row stored before the bounds stays readable.
export const LIBRARY_TEXT_LIMITS = {
  collectionName: 100,
  collectionDescription: 1_000,
  collectionNotes: 2_000,
  categoryName: 100,
  categoryDescription: 1_000,
  // A hex colour or a colour name, and an emoji or an icon name.
  color: 32,
  icon: 32,
  copyNotes: 5_000,
} as const;

export type LibraryTextField = keyof typeof LIBRARY_TEXT_LIMITS;

// The text to check; an absent field is not checked. The first one past its bound is the error.
export const checkLibraryText = (
  text: Partial<Record<LibraryTextField, string>>,
): Result<void, LibraryError> => {
  for (const [field, value] of Object.entries(text)) {
    const max = LIBRARY_TEXT_LIMITS[field as LibraryTextField];
    if ((value?.length ?? 0) > max) {
      return err(LibraryError.textTooLong(field as LibraryTextField, max));
    }
  }
  return ok(undefined);
};
