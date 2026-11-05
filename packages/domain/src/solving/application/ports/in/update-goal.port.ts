import { Result } from "../../../../shared-kernel";
import { GoalId, MemberId, SolvingError } from "../../../domain";
import { SolvingApplicationError } from "../../errors";

// Replace a goal's definition (title, description, target, period). Fields left out are cleared,
// so the caller sends the whole form. Only the goal's owner may do it; progress is recounted
// silently for the new period.
export interface UpdateGoalCommand {
  readonly actingMemberId: MemberId;
  readonly goalId: GoalId;
  readonly title: string;
  readonly description?: string;
  readonly targetCompletions: number;
  readonly startDate?: Date;
  readonly targetDate?: Date;
}

export interface UpdateGoal {
  (
    cmd: UpdateGoalCommand,
  ): Promise<Result<void, SolvingError | SolvingApplicationError>>;
}
