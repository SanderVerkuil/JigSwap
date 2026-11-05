import { Result } from "../../../../shared-kernel";
import { MemberId, SolvingError } from "../../../domain";

// Recompute the DERIVED progress of all of a member's active goals from their finished solves,
// each goal counting only the solves inside its own period. Driven by a completion being
// recorded, edited or deleted — the count is never hand-set on a Goal.
export interface RecomputeGoalProgressCommand {
  readonly userId: MemberId;
}

export interface RecomputeGoalProgress {
  (cmd: RecomputeGoalProgressCommand): Promise<Result<void, SolvingError>>;
}
