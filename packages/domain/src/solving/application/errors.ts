import { DomainError } from "../../shared-kernel";
import { CompletionId, GoalId, PuzzleDefinitionId } from "../domain";

// Orchestration-level failures the aggregates cannot express because they depend on the world
// (repository lookups) rather than their own data. Like SolvingError, the `code` is the stable,
// machine-readable discriminant a transport adapter maps to; the message is for logs/tests only.
export type SolvingApplicationErrorCode =
  "CompletionNotFound" | "GoalNotFound" | "PuzzleReviewNotFound";

export class SolvingApplicationError extends DomainError {
  override readonly name = "SolvingApplicationError";

  private constructor(
    readonly code: SolvingApplicationErrorCode,
    message: string,
  ) {
    super(message);
  }

  static completionNotFound(id: CompletionId): SolvingApplicationError {
    return new SolvingApplicationError(
      "CompletionNotFound",
      `Completion ${id} could not be found`,
    );
  }

  static goalNotFound(id: GoalId): SolvingApplicationError {
    return new SolvingApplicationError(
      "GoalNotFound",
      `Goal ${id} could not be found`,
    );
  }

  // The acting member has no review of this puzzle to delete.
  static puzzleReviewNotFound(
    puzzleId: PuzzleDefinitionId,
  ): SolvingApplicationError {
    return new SolvingApplicationError(
      "PuzzleReviewNotFound",
      `No review of puzzle ${puzzleId} by this member`,
    );
  }
}
