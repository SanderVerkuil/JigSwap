import { err, ok, Result } from "../../../shared-kernel";
import { Goal, GoalId, MemberId, SolvingError } from "../../domain";
import { SolvingApplicationError } from "../errors";
import { GoalRepository } from "../ports/out/goal.repository";

// Load a goal for a change by the acting member: GoalNotFound when it doesn't exist, NotGoalOwner
// when it belongs to someone else. Every goal-changing use case goes through here.
export const loadOwnedGoal = async (
  goals: GoalRepository,
  goalId: GoalId,
  actingMemberId: MemberId,
): Promise<Result<Goal, SolvingError | SolvingApplicationError>> => {
  const goal = await goals.findById(goalId);
  if (!goal) return err(SolvingApplicationError.goalNotFound(goalId));
  if (goal.userId !== actingMemberId) return err(SolvingError.notGoalOwner());
  return ok(goal);
};
