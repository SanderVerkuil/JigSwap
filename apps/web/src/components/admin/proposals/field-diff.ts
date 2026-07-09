// Pure mapping from an enriched change-proposal row (changes/baseline/current snapshots in
// the same field shape + derived conflictFields) to display rows for the admin review
// screen. Rendering/formatting stays in the component; this only pairs the values.

export interface FieldDiffRow {
  key: string;
  proposed: unknown;
  current: unknown;
  baseline: unknown;
  conflict: boolean;
}

export interface EnrichedDiffSource {
  changes: Record<string, unknown>;
  baseline: Record<string, unknown>;
  current: Record<string, unknown>;
  conflictFields: readonly string[];
}

export const fieldDiffRows = (source: EnrichedDiffSource): FieldDiffRow[] =>
  Object.entries(source.changes)
    .filter(([, proposed]) => proposed !== undefined)
    .map(([key, proposed]) => ({
      key,
      proposed,
      current: source.current[key],
      baseline: source.baseline[key],
      conflict: source.conflictFields.includes(key),
    }));
