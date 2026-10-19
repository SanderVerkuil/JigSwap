// Normalising a member-chosen display name (a circle's or a household's), so both follow one rule.

// Control characters (Cc: tabs, newlines, NUL, ...) read as a word break, so they become spaces.
const CONTROL_CHARACTERS = /\p{Cc}/gu;
// Format characters (Cf: bidi overrides/isolates, zero-width spaces, BOMs) are invisible and can
// disguise a name, so they go, except ZWNJ (U+200C) and ZWJ (U+200D): emoji ZWJ sequences and
// Persian/Indic spelling need them.
const FORMAT_CHARACTERS = /(?![‌‍])\p{Cf}/gu;
const WHITESPACE_RUNS = /\s+/gu;
// A name must show something: at least one letter, digit, symbol or punctuation mark.
const VISIBLE_CHARACTER = /[\p{L}\p{N}\p{S}\p{P}]/u;

// A name as stored: control characters to spaces, format characters (bar ZWNJ/ZWJ) removed,
// whitespace runs collapsed to one space, trimmed.
export const normaliseDisplayName = (raw: string): string =>
  raw
    .replace(CONTROL_CHARACTERS, " ")
    .replace(FORMAT_CHARACTERS, "")
    .replace(WHITESPACE_RUNS, " ")
    .trim();

// Whether a NORMALISED name shows at least one visible character.
export const hasVisibleCharacter = (name: string): boolean =>
  VISIBLE_CHARACTER.test(name);
