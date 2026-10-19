import { err, ok, Result } from "../../../shared-kernel";
import { Household, HouseholdError, MemberId } from "../../domain";
import { HouseholdDeps } from "./deps";

// The one atomic switch shared by accepting an invite and an approved request to join: admit the
// member into `target`, then leave `current` when there is one (the last member dissolves it and
// its pending invites; an admin hands over to the longest-standing member). Both aggregates are
// changed in memory first and persisted only when both succeeded, so a refusal writes nothing.
// The caller publishes the aggregates' events (they stay recorded on `current` and `target`).
export const switchHousehold = async (
  deps: Pick<HouseholdDeps, "households" | "invites">,
  props: {
    readonly memberId: MemberId;
    readonly current: Household | null;
    readonly target: Household;
    readonly now: Date;
  },
): Promise<Result<void, HouseholdError>> => {
  const { memberId, current, target, now } = props;
  const admitted = target.admit(memberId, now);
  if (admitted.isErr) return err(admitted.error);

  // Only now, with the join certain, leave the current household.
  const left = current ? current.leave(memberId, now) : null;
  if (left?.isErr) return err(left.error);

  if (current && left?.value.dissolved) {
    await deps.invites.removePendingForHousehold(current.id);
    await deps.households.remove(current.id);
  } else if (current) {
    await deps.households.save(current);
  }
  await deps.households.save(target);
  return ok(undefined);
};
