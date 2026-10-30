import { Result } from "../../../../shared-kernel";
import { GoalId, MemberId, SolvingError } from "../../../domain";
import { SolvingApplicationError } from "../../errors";

// Delete a goal the acting member owns, for good.
export interface DeleteGoalCommand {
  readonly actingMemberId: MemberId;
  readonly goalId: GoalId;
}

export interface DeleteGoal {
  (
    cmd: DeleteGoalCommand,
  ): Promise<Result<void, SolvingError | SolvingApplicationError>>;
}
