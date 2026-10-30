import { err, ok, Result } from "../../shared-kernel";
import { SocialError } from "./errors";

// The longest display name a member may choose, in UTF-16 code units (what an HTML maxLength
// counts, so the editor and the server agree).
export const DISPLAY_NAME_MAX_LENGTH = 50;

// C0 and C1 control characters plus the Unicode line and paragraph separators: each becomes a
// space, so a name cannot span lines.
const LINE_BREAKS_AND_CONTROLS = /[\p{Cc}\u2028\u2029]/gu;

// Invisible characters with no place in a name: the bidi marks, embeddings, overrides and
// isolates (U+061C, U+200E-U+200F, U+202A-U+202E, U+2066-U+2069) that can reorder how the name
// and the text around it read, plus the zero-width space, word joiner and byte-order mark. The
// zero-width joiner (U+200D) and non-joiner (U+200C) and the variation selectors are kept: emoji
// sequences and several scripts need them.
const INVISIBLE_CHARACTERS =
  /[\u061C\u200B\u200E\u200F\u202A-\u202E\u2060\u2066-\u2069\uFEFF]/gu;

// A member's public display name as an immutable value object validated at construction. The
// raw input is cleaned (line breaks and controls become spaces, invisible bidi and zero-width
// characters are dropped, whitespace runs collapse, the ends are trimmed) and then checked: an
// empty name or one longer than DISPLAY_NAME_MAX_LENGTH is rejected with InvalidDisplayName.
export class DisplayName {
  private constructor(readonly value: string) {}

  static create(value: string): Result<DisplayName, SocialError> {
    const cleaned = value
      .replace(LINE_BREAKS_AND_CONTROLS, " ")
      .replace(INVISIBLE_CHARACTERS, "")
      .replace(/\s+/g, " ")
      .trim();
    if (cleaned.length === 0) {
      return err(SocialError.invalidDisplayName());
    }
    if (cleaned.length > DISPLAY_NAME_MAX_LENGTH) {
      return err(SocialError.displayNameTooLong(DISPLAY_NAME_MAX_LENGTH));
    }
    return ok(new DisplayName(cleaned));
  }

  // Rehydrate a stored name without re-validating it. A row written before the length cap may
  // hold a longer name; it stays readable (and is kept on edits that leave the name alone).
  static fromState(value: string): DisplayName {
    return new DisplayName(value);
  }
}
