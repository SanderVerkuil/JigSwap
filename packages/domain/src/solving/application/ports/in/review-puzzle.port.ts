import { Result } from "../../../../shared-kernel";
import {
  CompletionId,
  MemberId,
  SolvingError,
} from "../../../domain";
import { SolvingApplicationError } from "../../errors";

// Attach a PuzzleReview (opinion of the puzzle) to a completion. `rating` is validated 1–5.
export interface ReviewPuzzleCommand {
  readonly actingMemberId: MemberId;
  readonly completionId: CompletionId;
  readonly rating: number;
  readonly text?: string;
}

export interface ReviewPuzzle {
  (
    cmd: ReviewPuzzleCommand,
  ): Promise<Result<void, SolvingError | SolvingApplicationError>>;
}
