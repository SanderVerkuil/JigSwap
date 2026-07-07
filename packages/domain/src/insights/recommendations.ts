// Recommendation read-model: a PURE, total projection that ranks catalog puzzle definitions the
// member does NOT already own, scored from their revealed preferences. Like the sibling insights
// projections this owns the maths and has NO Convex imports; the adapter fetches rows, reduces them
// to these plain facet DTOs, and applies `recommendPuzzles`. Deterministic and explainable: scores
// are facet-overlap weights with a popularity tiebreak, never throwing.

// A catalog puzzle reduced to the facets that drive similarity. `pieceCount` is banded (not raw) so
// "near in size" generalises; `categoryKeys` folds the category id and tag keys into one set.
export interface PuzzleFacets {
  readonly brand?: string;
  readonly pieceCount?: number;
  readonly categoryKeys?: readonly string[];
}

// The member's revealed taste, aggregated from the facets of puzzles they own/completed. Plain
// counts so affinity is weighted by how often a facet recurs (3 Ravensburger > 1).
export interface MemberSignals {
  readonly facets: readonly PuzzleFacets[];
}

// A catalog definition considered for recommendation. `key` is the catalog id the adapter resolves
// back to a view object; `popularity` (e.g. owner count) breaks ties and seeds the cold-start
// fallback; `recencyRank` (smaller = newer) is a final, fully-deterministic tiebreak.
export interface CandidatePuzzle extends PuzzleFacets {
  readonly key: string;
  readonly popularity?: number;
  readonly recencyRank?: number;
}

export interface RecommendationInput {
  readonly signals: MemberSignals;
  // Catalog candidates to rank; the adapter has already excluded the member's owned definitions, but
  // we defensively exclude any whose key is in `ownedKeys` too.
  readonly candidates: readonly CandidatePuzzle[];
  readonly ownedKeys?: readonly string[];
  // Cap the returned list; <= 0 or omitted returns all ranked candidates.
  readonly limit?: number;
}

// Why a candidate surfaced. Machine-readable so the UI can render a localised chip; the strongest
// contributing facet wins, falling back to "popular" for the cold-start / no-overlap case.
export type RecommendationReason =
  "sameBrand" | "similarPieceCount" | "sharedCategory" | "popular";

export interface PuzzleRecommendation {
  readonly key: string;
  readonly score: number;
  readonly reason: RecommendationReason;
}

// Facet weights: brand affinity is the strongest taste signal, category/tag overlap next, a similar
// piece-count band weakest. Popularity only ever acts as a sub-point tiebreak so it can never
// outrank a genuine facet match.
const WEIGHT_BRAND = 3;
const WEIGHT_CATEGORY = 2;
const WEIGHT_PIECE_BAND = 1;
// Popularity contributes < 1 total so it orders ties without overtaking the next weight tier.
const POPULARITY_TIEBREAK_MAX = 0.999;

// Same ascending bands as the collection breakdown chart; "near in size" = same band. Boundaries are
// inclusive-lower / exclusive-upper so exactly 500 lands in the 500-999 band.
const pieceBand = (n: number | undefined): number | undefined => {
  if (typeof n !== "number" || !Number.isFinite(n)) return undefined;
  if (n < 100) return 0;
  if (n < 300) return 1;
  if (n < 500) return 2;
  if (n < 1000) return 3;
  if (n < 2000) return 4;
  return 5;
};

const normaliseBrand = (brand: string | undefined): string | undefined => {
  const trimmed = brand?.trim().toLowerCase();
  return trimmed && trimmed.length > 0 ? trimmed : undefined;
};

const normaliseKeys = (keys: readonly string[] | undefined): string[] =>
  (keys ?? []).map((k) => k.trim().toLowerCase()).filter((k) => k.length > 0);

// The member's taste reduced to affinity sets/counts across the facets of all their puzzles. With
// no signals every set is empty, so scoring naturally degrades to a pure popularity ordering.
interface Affinity {
  readonly brands: ReadonlySet<string>;
  readonly bands: ReadonlySet<number>;
  readonly categories: ReadonlySet<string>;
}

const buildAffinity = (signals: MemberSignals): Affinity => {
  const brands = new Set<string>();
  const bands = new Set<number>();
  const categories = new Set<string>();
  for (const facet of signals.facets) {
    const brand = normaliseBrand(facet.brand);
    if (brand) brands.add(brand);
    const band = pieceBand(facet.pieceCount);
    if (band !== undefined) bands.add(band);
    for (const key of normaliseKeys(facet.categoryKeys)) categories.add(key);
  }
  return { brands, bands, categories };
};

// A candidate's facet score plus the reason for its single strongest contribution. Reasons are
// ordered by weight so the dominant facet is reported; popularity-only matches read as "popular".
interface Scored {
  readonly facetScore: number;
  readonly reason: RecommendationReason;
}

const scoreFacets = (
  candidate: CandidatePuzzle,
  affinity: Affinity,
): Scored => {
  let facetScore = 0;
  // Facets are evaluated strongest-weighted first, so the first match names the dominant reason;
  // later matches still add to the score but never overwrite a stronger facet's reason.
  let reason: RecommendationReason = "popular";

  const brand = normaliseBrand(candidate.brand);
  if (brand && affinity.brands.has(brand)) {
    facetScore += WEIGHT_BRAND;
    reason = "sameBrand";
  }

  const sharesCategory = normaliseKeys(candidate.categoryKeys).some((k) =>
    affinity.categories.has(k),
  );
  if (sharesCategory) {
    facetScore += WEIGHT_CATEGORY;
    if (reason === "popular") reason = "sharedCategory";
  }

  const band = pieceBand(candidate.pieceCount);
  if (band !== undefined && affinity.bands.has(band)) {
    facetScore += WEIGHT_PIECE_BAND;
    if (reason === "popular") reason = "similarPieceCount";
  }

  return { facetScore, reason };
};

// Squash a candidate's popularity into the [0, POPULARITY_TIEBREAK_MAX) tiebreak band. Relative to
// the most-popular candidate in the set so it is scale-free; non-positive popularity contributes 0.
const popularityTiebreak = (
  popularity: number | undefined,
  maxPopularity: number,
): number => {
  if (maxPopularity <= 0) return 0;
  const p = typeof popularity === "number" && popularity > 0 ? popularity : 0;
  return (p / maxPopularity) * POPULARITY_TIEBREAK_MAX;
};

// Rank catalog candidates by how well they fit the member's revealed taste. Owned candidates are
// excluded; facet overlap drives the score with a popularity tiebreak; with no signals at all the
// list degrades gracefully to a pure popularity ordering (every reason "popular"). Highest score
// first, then popularity, then recency, then key — fully deterministic. Total: never throws.
export const recommendPuzzles = (
  input: RecommendationInput,
): readonly PuzzleRecommendation[] => {
  const affinity = buildAffinity(input.signals);
  const owned = new Set(normaliseKeys(input.ownedKeys));

  const eligible = input.candidates.filter(
    (c) => c.key.length > 0 && !owned.has(c.key.trim().toLowerCase()),
  );

  const maxPopularity = eligible.reduce(
    (max, c) => Math.max(max, c.popularity ?? 0),
    0,
  );

  const ranked = eligible
    .map((candidate) => {
      const { facetScore, reason } = scoreFacets(candidate, affinity);
      const score =
        facetScore + popularityTiebreak(candidate.popularity, maxPopularity);
      return { candidate, score, reason };
    })
    .sort(
      (a, b) =>
        b.score - a.score ||
        (b.candidate.popularity ?? 0) - (a.candidate.popularity ?? 0) ||
        (a.candidate.recencyRank ?? Number.MAX_SAFE_INTEGER) -
          (b.candidate.recencyRank ?? Number.MAX_SAFE_INTEGER) ||
        a.candidate.key.localeCompare(b.candidate.key),
    )
    .map((r): PuzzleRecommendation => ({
      key: r.candidate.key,
      score: r.score,
      reason: r.reason,
    }));

  const limit = input.limit;
  return typeof limit === "number" && limit > 0
    ? ranked.slice(0, limit)
    : ranked;
};
