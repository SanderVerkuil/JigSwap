// Distributions over the member's owned copies, shaped for chart components: every distribution is
// a `{ label, value }[]`. Pure and total — empty input yields empty arrays.
//
// Labels are data (a bucket range, a brand, a difficulty enum), never display words: "no value"
// and "the long tail" are the sentinels below, which the client translates.

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

// Bucket for copies without a value (no piece count, brand, difficulty or condition). Always listed
// last, after every real value and after OTHER_BUCKET. Part of the insights wire contract: the web
// (components/insights/collection-breakdown.tsx) mirrors both strings and translates them.
export const UNKNOWN_BUCKET = "__unknown";
// The brands beyond the top N, summed into one entry.
export const OTHER_BUCKET = "__other";

// The trailing unknown bucket, or nothing when every copy has a value.
const unknownEntry = (count: number): DistributionEntry[] =>
  count > 0 ? [{ label: UNKNOWN_BUCKET, value: count }] : [];

// Bucket each copy's piece count into the ordered ranges; copies with no piece count fall in the
// unknown bucket. Only non-empty buckets are returned, preserving the natural ascending order.
const pieceCountDistribution = (
  copies: readonly CopyBreakdownInput[],
): DistributionEntry[] => {
  const counts = new Map<string, number>();
  for (const copy of copies) {
    const n = copy.pieceCount;
    const label =
      typeof n === "number" && Number.isFinite(n)
        ? (PIECE_BUCKETS.find((b) => n < b.below)?.label ?? UNKNOWN_BUCKET)
        : UNKNOWN_BUCKET;
    counts.set(label, (counts.get(label) ?? 0) + 1);
  }
  // Emit buckets in their declared order, then a trailing unknown bucket if present.
  const ordered: DistributionEntry[] = [];
  for (const b of PIECE_BUCKETS) {
    const value = counts.get(b.label);
    if (value) ordered.push({ label: b.label, value });
  }
  return [...ordered, ...unknownEntry(counts.get(UNKNOWN_BUCKET) ?? 0)];
};

// Count a string-valued facet. Real values are sorted by value desc, then label asc for stable,
// deterministic output; missing/blank values are counted apart so callers can list them last.
const countFacet = (
  copies: readonly CopyBreakdownInput[],
  pick: (copy: CopyBreakdownInput) => string | undefined,
): { known: DistributionEntry[]; unknown: number } => {
  const counts = new Map<string, number>();
  let unknown = 0;
  for (const copy of copies) {
    const raw = pick(copy);
    if (raw && raw.trim().length > 0) {
      counts.set(raw, (counts.get(raw) ?? 0) + 1);
    } else {
      unknown += 1;
    }
  }
  const known = sortEntries(
    [...counts.entries()].map(([label, value]) => ({ label, value })),
  );
  return { known, unknown };
};

// A facet's real values, then the unknown bucket last however large it is.
const facetDistribution = (
  copies: readonly CopyBreakdownInput[],
  pick: (copy: CopyBreakdownInput) => string | undefined,
): DistributionEntry[] => {
  const { known, unknown } = countFacet(copies, pick);
  return [...known, ...unknownEntry(unknown)];
};

const sortEntries = (entries: DistributionEntry[]): DistributionEntry[] =>
  [...entries].sort(
    (a, b) => b.value - a.value || a.label.localeCompare(b.label),
  );

// Like a facet distribution but collapse the long tail: keep the top `topN` real brands and sum the
// rest into a single OTHER_BUCKET entry, then the unknown bucket last. Copies without a brand never
// compete for a top-N slot. With <= topN distinct brands no OTHER_BUCKET appears.
const brandDistribution = (
  copies: readonly CopyBreakdownInput[],
  topN: number,
): DistributionEntry[] => {
  const { known, unknown } = countFacet(copies, (c) => c.brand);
  const top = known.slice(0, topN);
  const otherValue = known
    .slice(topN)
    .reduce((acc, entry) => acc + entry.value, 0);
  const other =
    otherValue > 0 ? [{ label: OTHER_BUCKET, value: otherValue }] : [];
  return [...top, ...other, ...unknownEntry(unknown)];
};

// The "Top brands" chart shows six brands; the rest fold into OTHER_BUCKET here, so the chart can
// render the series as is instead of re-ranking or cutting it.
const DEFAULT_BRAND_TOP_N = 6;

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
