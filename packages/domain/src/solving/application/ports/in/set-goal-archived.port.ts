import { Result } from "../../../../shared-kernel";
import { GoalId, MemberId, SolvingError } from "../../../domain";
import { SolvingApplicationError } from "../../errors";

// Archive a goal (it stops following new solves) or restore it (it is recounted). Owner only.
export interface SetGoalArchivedCommand {
  readonly actingMemberId: MemberId;
  readonly goalId: GoalId;
  readonly archived: boolean;
}

export interface SetGoalArchived {
  (
    cmd: SetGoalArchivedCommand,
  ): Promise<Result<void, SolvingError | SolvingApplicationError>>;
}
