import { DomainEvent, ok } from "../../../shared-kernel";
import { JoinHouseholdByLink } from "../ports/in";
import { makeAcceptHouseholdInvite } from "./accept-household-invite";
import { HouseholdDeps } from "./deps";
import { makeInviteToHousehold } from "./invite-to-household";

// An existing member accepts a household invite LINK: the same path as an in-app invite, as one
// step. The link's owner invites the actor (admin-only, actor in no household) and the actor accepts
// at once (the authoritative at-most-one-household check), or accepts the invite already pending
// from that household. The acceptance and the join are published; the invite-sent event is not,
// because the actor is answering it right now and a "you were invited" notification would be noise.
export const makeJoinHouseholdByLink =
  (deps: HouseholdDeps): JoinHouseholdByLink =>
  async (cmd) => {
    const buffered: DomainEvent[] = [];
    const quiet: HouseholdDeps = {
      ...deps,
      events: {
        publish: async (events) => {
          buffered.push(...events);
        },
      },
    };

    const household = await deps.households.findByMember(cmd.inviterId);
    const pending = household
      ? await deps.invites.findPending(household.id, cmd.actorId)
      : null;
    const invited = pending
      ? ok(pending.id)
      : await makeInviteToHousehold(quiet)({
          actorId: cmd.inviterId,
          inviteeId: cmd.actorId,
        });
    if (invited.isErr) return invited;

    const joined = await makeAcceptHouseholdInvite(quiet)({
      actorId: cmd.actorId,
      inviteId: invited.value,
    });
    await deps.events.publish(
      buffered.filter((event) => event.name !== "HouseholdInviteSent"),
    );
    return joined;
  };
