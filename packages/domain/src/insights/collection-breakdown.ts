// Distributions over the member's owned copies, shaped for chart components: every distribution is
// a `{ label, value }[]`. Pure and total — empty input yields empty arrays.

export interface CopyBreakdownInput {
  // Piece count of the puzzle (from the copy's catalog snapshot); buckets group these.
  readonly pieceCount?: number;
  readonly brand?: string;
  readonly difficulty?: string;
  readonly condition?: string;
}

export interface DistributionEntry {
  readonly label: string;
  readonly value: number;
}

export interface CollectionBreakdown {
  readonly byPieceCount: DistributionEntry[];
  readonly byBrand: DistributionEntry[];
  readonly byDifficulty: DistributionEntry[];
  readonly byCondition: DistributionEntry[];
}

// Piece-count buckets, ordered low→high. Each carries only its exclusive upper bound: a count lands
// in the first bucket it falls below, so the lower edge is implied by the previous bucket and every
// boundary is single-sourced (e.g. 300 appears once). The final Infinity bound catches 2000+.
const PIECE_BUCKETS: ReadonlyArray<{ label: string; below: number }> = [
  { label: "< 100", below: 100 },
  { label: "100-299", below: 300 },
  { label: "300-499", below: 500 },
  { label: "500-999", below: 1000 },
  { label: "1000-1999", below: 2000 },
  { label: "2000+", below: Number.POSITIVE_INFINITY },
];

const UNKNOWN_LABEL = "Unknown";
const OTHER_LABEL = "Other";

// Bucket each copy's piece count into the ordered ranges; copies with no piece count fall in
// "Unknown". Only non-empty buckets are returned, preserving the natural ascending order.
const pieceCountDistribution = (
  copies: readonly CopyBreakdownInput[],
): DistributionEntry[] => {
  const counts = new Map<string, number>();
  for (const copy of copies) {
    const n = copy.pieceCount;
    const label =
      typeof n === "number" && Number.isFinite(n)
        ? (PIECE_BUCKETS.find((b) => n < b.below)?.label ?? UNKNOWN_LABEL)
        : UNKNOWN_LABEL;
    counts.set(label, (counts.get(label) ?? 0) + 1);
  }
  // Emit buckets in their declared order, then a trailing Unknown if present.
  const ordered: DistributionEntry[] = [];
  for (const b of PIECE_BUCKETS) {
    const value = counts.get(b.label);
    if (value) ordered.push({ label: b.label, value });
  }
  const unknown = counts.get(UNKNOWN_LABEL);
  if (unknown) ordered.push({ label: UNKNOWN_LABEL, value: unknown });
  return ordered;
};

// Count a string-valued facet, mapping missing/blank values to "Unknown". Sorted by value desc,
// then label asc for stable, deterministic output.
const facetDistribution = (
  copies: readonly CopyBreakdownInput[],
  pick: (copy: CopyBreakdownInput) => string | undefined,
): DistributionEntry[] => {
  const counts = new Map<string, number>();
  for (const copy of copies) {
    const raw = pick(copy);
    const label = raw && raw.trim().length > 0 ? raw : UNKNOWN_LABEL;
    counts.set(label, (counts.get(label) ?? 0) + 1);
  }
  return sortEntries(
    [...counts.entries()].map(([label, value]) => ({ label, value })),
  );
};

const sortEntries = (entries: DistributionEntry[]): DistributionEntry[] =>
  [...entries].sort(
    (a, b) => b.value - a.value || a.label.localeCompare(b.label),
  );

// Like a facet distribution but collapse the long tail: keep the top `topN` brands, sum the rest
// into a single "Other" entry appended last. With <= topN distinct brands no "Other" appears.
const brandDistribution = (
  copies: readonly CopyBreakdownInput[],
  topN: number,
): DistributionEntry[] => {
  const all = facetDistribution(copies, (c) => c.brand);
  if (all.length <= topN) return all;
  const top = all.slice(0, topN);
  const otherValue = all
    .slice(topN)
    .reduce((acc, entry) => acc + entry.value, 0);
  return [...top, { label: OTHER_LABEL, value: otherValue }];
};

const DEFAULT_BRAND_TOP_N = 8;

// Compute all four distributions for the collection charts. `topN` caps the brand chart's series.
export const computeCollectionBreakdown = (
  copies: readonly CopyBreakdownInput[],
  topN: number = DEFAULT_BRAND_TOP_N,
): CollectionBreakdown => ({
  byPieceCount: pieceCountDistribution(copies),
  byBrand: brandDistribution(copies, topN),
  byDifficulty: facetDistribution(copies, (c) => c.difficulty),
  byCondition: facetDistribution(copies, (c) => c.condition),
});
