import { err, ok } from "../../../shared-kernel";
import { HouseholdError, HouseholdJoinRequest } from "../../domain";
import { HouseholdApplicationError } from "../errors";
import { RequestToJoinHousehold } from "../ports/in";
import { HouseholdDeps } from "./deps";

// A member asks to join the household an expired or used invite link was minted for. Limits: one
// request per link, ever, and one open request at a time (a silently declined or dropped one
// counts: the requester can't tell them apart from waiting). A member in another household must
// consent to leaving it (leaveCurrentHousehold); the household and what leaving does to it are
// stored, and approval goes ahead only while both still hold. Whether the request reaches the
// admin is never part of the answer: when the household is gone, the link's owner is no longer its
// admin, or the pair is blocked, the request is stored as dropped, records no event, and an admin
// never sees it.
export const makeRequestToJoinHousehold =
  (
    deps: Pick<
      HouseholdDeps,
      "households" | "joinRequests" | "joinRequestIds" | "events" | "clock"
    >,
  ): RequestToJoinHousehold =>
  async (cmd) => {
    const now = deps.clock.now();
    const target = await deps.households.findById(cmd.householdId);
    if (target?.isMember(cmd.actorId)) {
      return err(HouseholdError.alreadyMember());
    }
    if (
      await deps.joinRequests.findByRequesterAndLink(cmd.actorId, cmd.linkId)
    ) {
      return err(HouseholdApplicationError.joinRequestAlreadySent());
    }

    const current = await deps.households.findByMember(cmd.actorId);
    const waiting = await deps.joinRequests.listWaitingByRequester(cmd.actorId);
    if (waiting.some((r) => r.isOpen(now) && r.consentHolds(current))) {
      return err(HouseholdApplicationError.joinRequestOpen());
    }
    if (current && !cmd.leaveCurrentHousehold) {
      return err(HouseholdApplicationError.alreadyInHousehold());
    }

    const created = HouseholdJoinRequest.request({
      id: deps.joinRequestIds.next(),
      householdId: cmd.householdId,
      requesterId: cmd.actorId,
      adminId: cmd.adminId,
      linkId: cmd.linkId,
      leave: current
        ? {
            householdId: current.id,
            consequence: current.leaveConsequenceFor(cmd.actorId),
          }
        : undefined,
      dropped: cmd.blocked || !target?.isAdmin(cmd.adminId),
      now,
    });
    if (created.isErr) return err(created.error);
    const request = created.value;

    await deps.joinRequests.save(request);
    await deps.events.publish(request.pullEvents());
    return ok(request.id);
  };
