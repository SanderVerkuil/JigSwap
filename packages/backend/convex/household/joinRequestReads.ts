import { householdLeaveConsequence, toMemberId } from "@jigswap/domain";
import type { Doc } from "../_generated/dataModel";
import type { QueryCtx } from "../_generated/server";
import { membershipOf, membersOfHousehold } from "./memberships";

// Read-side rules for requests to join, shared by the requester's queries (myJoinRequest, the
// invite-link landing). They mirror the HouseholdJoinRequest aggregate's isOpen + consentHolds.

// Whether the requester is still where they consented to be: in no household when they gave no
// consent, else in the household they agreed to leave, with the same consequence of leaving it.
const consentHolds = async (
  ctx: QueryCtx,
  row: Doc<"householdJoinRequests">,
): Promise<boolean> => {
  const membership = await membershipOf(ctx, row.requesterId);
  if (row.leaveHouseholdId === undefined) return membership === null;
  if (membership?.householdId !== row.leaveHouseholdId) return false;
  const members = await membersOfHousehold(ctx, membership.householdId);
  return (
    householdLeaveConsequence(
      members.map((m) => ({ memberId: toMemberId(m.memberId), role: m.role })),
      toMemberId(row.requesterId),
    ) === row.leaveConsequence
  );
};

// Open as the requester sees it: waiting (silently declined and dropped included), not lapsed, and
// still approvable as consented. Anything else is closed for them.
export const isOpenForRequester = async (
  ctx: QueryCtx,
  row: Doc<"householdJoinRequests">,
  now: number,
): Promise<boolean> =>
  (row.status === "pending" || row.status === "declined") &&
  row.expiresAt > now &&
  (await consentHolds(ctx, row));
