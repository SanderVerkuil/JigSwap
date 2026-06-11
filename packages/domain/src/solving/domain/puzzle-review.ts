import { StarRating } from "./star-rating";

// The persistable shape of a PuzzleReview, kept close to the `completions.rating`/`completions.review`
// columns so the 2c mapper is a near field-for-field translation.
export interface PuzzleReviewState {
  readonly rating: number;
  readonly text?: string;
}

// A PuzzleReview is an opinion OF THE PUZZLE (1–5 stars + optional free text), attached to a
// Completion. Named PuzzleReview — NOT "Review" — to kill the homonym: this is the marketing
// "rating", distinct from Reputation's PartnerReview (trust feedback about a person, §1.5).
//
// Modelled as a value object owned by the Completion aggregate (it has no identity of its own
// in persistence; it lives in the completion's `rating`/`review` columns).
export class PuzzleReview {
  private constructor(
    readonly rating: StarRating,
    readonly text?: string,
  ) {}

  static create(rating: StarRating, text?: string): PuzzleReview {
    // Normalise an empty/whitespace-only text to undefined so persistence never stores "".
    const trimmed = text?.trim();
    return new PuzzleReview(
      rating,
      trimmed && trimmed.length > 0 ? trimmed : undefined,
    );
  }

  // Rehydrate from persisted (already-validated) columns.
  static fromState(state: PuzzleReviewState): PuzzleReview {
    return new PuzzleReview(StarRating.fromState(state.rating), state.text);
  }

  toState(): PuzzleReviewState {
    return { rating: this.rating.value, text: this.text };
  }
}
