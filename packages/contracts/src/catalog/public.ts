// View DTOs for the UNAUTHENTICATED public catalog surfaces (/catalog, /catalog/$id). These are
// deliberately narrower than the member-facing views: no owner identities, no copy-level data,
// no member ids ever cross the wire to a logged-out visitor.

import type { PuzzleDifficulty } from "./views";

/** Aggregate availability over open copies whose OWNER'S PROFILE IS PUBLIC (no circle reachability —
 * there is no viewer). Each copy counts once under its priority swap type (trade→swap, lend, sale). */
export interface PublicAvailabilityView {
  total: number;
  byType: { swap: number; lend: number; sale: number };
}

/** One card in the public catalog list. `image` is the resolved box-art URL. */
export interface PublicCatalogCardView {
  _id: string;
  title: string;
  brand?: string;
  pieceCount: number;
  difficulty?: PuzzleDifficulty;
  image: string | null;
  rating: { value: number; count: number };
  /** PublicAvailabilityView.total, denormalized for the card's "N to swap" badge. */
  availableToSwap: number;
}

/** The public catalog detail view — catalog facts + community aggregates, nothing member-level. */
export interface PublicDefinitionDetailView {
  definition: {
    title: string;
    description?: string;
    brand?: string;
    publisher?: string;
    artist?: string;
    series?: string;
    pieceCount: number;
    image?: string;
    difficulty?: PuzzleDifficulty;
    categoryName?: string;
    tags: string[];
    shape?: "rectangular" | "panoramic" | "round" | "shaped";
    dimensions?: { width: number; height: number; unit: "cm" | "in" };
  };
  rating: {
    rating: number;
    count: number;
    /** index 0..4 == [5★,4★,3★,2★,1★] — matches the member-facing detail view. */
    breakdown: [number, number, number, number, number];
    percentages: [number, number, number, number, number];
  };
  stats: {
    communityOwners: number;
    totalCompletions: number;
    avgCompletionDays: number | null;
  };
  availability: PublicAvailabilityView;
}

/** A community review as shown on the public catalog page. `author` is null when the author's
 * profile is private — the UI renders a generic "A JigSwap member". */
export interface PublicPuzzleReviewView {
  id: string;
  author: { name: string; avatar: string | null } | null;
  text: string;
  rating: number | null;
  createdAt: number;
}
