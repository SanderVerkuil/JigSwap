// Text search ignores accents: "cafe" finds "Café". Convex's search index matches words as written,
// so the accents go on both sides, from the stored column and from the term.
export const foldDiacritics = (text: string): string =>
  text.normalize("NFD").replace(/\p{M}/gu, "");

// The searchable-fields projection shared by the aggregate (every save), the one-shot publisher
// migration and the fold backfill (which recompute the column outside a full aggregate load).
export interface PuzzleSearchableParts {
  readonly title: string;
  readonly brand?: string;
  readonly publisher?: string;
  readonly artist?: string;
  readonly series?: string;
  readonly tags?: readonly string[];
}

export const puzzleSearchableText = (parts: PuzzleSearchableParts): string =>
  foldDiacritics(
    [
      parts.title,
      parts.brand,
      parts.publisher,
      parts.artist,
      parts.series,
      ...(parts.tags ?? []),
    ]
      .filter((part): part is string => part !== undefined && part.length > 0)
      .join(" "),
  );

// What a catalogue search asks the index for: the folded term, after any word as it was typed with
// its accents. Those match rows whose column predates the fold (catalog/backfillSearchableText);
// everything else is written folded. The folded term comes last because the index matches only the
// last word as a prefix, and that is the word still being typed.
export const puzzleSearchTerm = (input: string): string => {
  const term = input.trim().toLowerCase();
  const folded = foldDiacritics(term);
  if (folded === term) return term;
  const accented = term
    .split(/\s+/)
    .filter((word) => foldDiacritics(word) !== word);
  return [...accented, folded].join(" ");
};
