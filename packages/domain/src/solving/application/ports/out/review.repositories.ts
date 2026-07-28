import { CopyId, MemberId, PuzzleDefinitionId } from "../../../domain";

// Outbound ports: persistence for the two-level review model. Each member holds AT MOST ONE
// puzzle review per puzzle and AT MOST ONE copy review per copy — `upsert` creates the row or
// replaces the existing one; enforcing that cardinality is the 2c-convex adapter's job (the
// `puzzleReviews`/`copyReviews` tables), never the domain's.

// The already-normalised values a puzzle-review upsert persists.
export interface PuzzleReviewUpsert {
  readonly userId: MemberId;
  readonly puzzleId: PuzzleDefinitionId;
  readonly rating: number;
  readonly text?: string;
  readonly now: Date;
}

export interface PuzzleReviewRepository {
  upsert(review: PuzzleReviewUpsert): Promise<void>;
}

// The already-normalised values a star-only copy-review upsert persists.
export interface CopyReviewUpsert {
  readonly userId: MemberId;
  readonly copyId: CopyId;
  readonly rating: number;
  readonly now: Date;
}

export interface CopyReviewRepository {
  upsert(review: CopyReviewUpsert): Promise<void>;
}
