import { Result } from "../../../../shared-kernel";
import { GoalId, MemberId, SolvingError } from "../../../domain";

// Create a completion-count goal. `userId` is resolved from auth by the transport adapter.
// `startDate`/`targetDate` are calendar dates (UTC midnight); without a start date the goal counts
// from the day it is created. Progress starts at the solves already inside that period.
export interface CreateGoalCommand {
  readonly userId: MemberId;
  readonly title: string;
  readonly description?: string;
  readonly targetCompletions: number;
  readonly startDate?: Date;
  readonly targetDate?: Date;
}

export interface CreateGoal {
  (cmd: CreateGoalCommand): Promise<Result<GoalId, SolvingError>>;
}
