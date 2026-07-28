import { Result } from "../../../../shared-kernel";
import { MemberId, PuzzleDefinitionId, SolvingError } from "../../../domain";

// Create or replace the member's single review of a puzzle (one per member+puzzle; the
// persistence adapter enforces the cardinality). `rating` is validated 1–5.
export interface UpsertPuzzleReviewCommand {
  readonly actingMemberId: MemberId;
  readonly puzzleDefinitionId: PuzzleDefinitionId;
  readonly rating: number;
  readonly text?: string;
}

export interface UpsertPuzzleReview {
  (cmd: UpsertPuzzleReviewCommand): Promise<Result<void, SolvingError>>;
}
