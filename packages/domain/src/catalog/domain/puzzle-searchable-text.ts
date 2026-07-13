// The searchable-fields projection shared by the aggregate (every save) and the one-shot
// publisher migration (which recomputes the column outside a full aggregate load).
export interface PuzzleSearchableParts {
  readonly title: string;
  readonly brand?: string;
  readonly publisher?: string;
  readonly artist?: string;
  readonly series?: string;
  readonly tags?: readonly string[];
}

export const puzzleSearchableText = (parts: PuzzleSearchableParts): string =>
  [
    parts.title,
    parts.brand,
    parts.publisher,
    parts.artist,
    parts.series,
    ...(parts.tags ?? []),
  ]
    .filter((part): part is string => part !== undefined && part.length > 0)
    .join(" ");
