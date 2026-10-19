import { err, ok } from "../../../shared-kernel";
import { HouseholdError } from "../../domain";
import { HouseholdApplicationError } from "../errors";
import { RevokeHouseholdInvite } from "../ports/in";
import { HouseholdDeps } from "./deps";

// The admin of the household an invite came from withdraws it while it is still pending: the
// invite goes, as if it had never been sent (no event; nobody is told). Whoever sent it, the
// household's current admin may revoke it. An answered invite stays: that was the invitee's call.
export const makeRevokeHouseholdInvite =
  (
    deps: Pick<HouseholdDeps, "households" | "invites">,
  ): RevokeHouseholdInvite =>
  async (cmd) => {
    const invite = await deps.invites.findById(cmd.inviteId);
    if (!invite) return err(HouseholdApplicationError.inviteNotFound());
    const household = await deps.households.findById(invite.householdId);
    if (!household?.isAdmin(cmd.actorId)) {
      return err(HouseholdError.notHouseholdAdmin());
    }
    if (invite.status !== "pending") {
      return err(HouseholdError.inviteNotPending());
    }
    await deps.invites.remove(invite.id);
    return ok(undefined);
  };
