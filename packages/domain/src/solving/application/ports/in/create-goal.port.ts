import { Result } from "../../../../shared-kernel";
import { GoalId, MemberId, SolvingError } from "../../../domain";

// Create a completion-count goal. `userId` is resolved from auth by the transport adapter.
export interface CreateGoalCommand {
  readonly userId: MemberId;
  readonly title: string;
  readonly description?: string;
  readonly targetCompletions: number;
  readonly targetDate?: Date;
}

export interface CreateGoal {
  (cmd: CreateGoalCommand): Promise<Result<GoalId, SolvingError>>;
}
