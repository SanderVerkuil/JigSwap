import { ConvexError } from "convex/values";
import type { Doc, Id } from "../_generated/dataModel";
import type { QueryCtx } from "../_generated/server";
import { membershipOf } from "../household/memberships";
import { isBlockedEitherWay } from "./blocks";
import { isNetworkLink } from "./inviteLinkRules";

// Where an EXISTING member stands on a household invite link (the signed-in landing's Accept /
// Decline). One resolver for the landing query and both mutations, so they can never disagree:
// - "invalid": unknown, a network link, revoked, or the owner is no longer the admin of the
//   household the link was minted for (left, or the household dissolved), or the inviter and the
//   member are blocked either way (spec 2.6);
// - "own-link": the inviter opened their own link (whatever its expiry or use);
// - "own-household": the member already belongs to the household the link was minted for (only
//   ever told to its members, so it reveals nothing they don't know);
// - "used" / "expired": single use and the 14-day expiry, checked server-side BEFORE the block and
//   admin checks, so they never reveal either. Only these two let the member ask to join
//   (household/requestToJoinHousehold);
// - "already-in-household": the one-household rule (no Accept is offered);
// - "can-accept": everything above passed.
export type HouseholdLinkState =
  | "can-accept"
  | "already-in-household"
  | "own-link"
  | "own-household"
  | "expired"
  | "used"
  | "invalid";

// The link is returned while it is live for this member (can-accept, already-in-household) and
// when it is expired or used (a request to join is asked from it).
export type HouseholdLinkResolution =
  | {
      state: "can-accept" | "already-in-household" | "expired" | "used";
      link: Doc<"inviteLinks">;
    }
  | {
      state: "own-link" | "own-household" | "invalid";
      link?: undefined;
    };

export const resolveHouseholdLink = async (
  ctx: QueryCtx,
  token: string,
  memberId: Id<"users">,
  now: number,
): Promise<HouseholdLinkResolution> => {
  const link = await ctx.db
    .query("inviteLinks")
    .withIndex("by_token", (q) => q.eq("token", token))
    .unique();
  if (link === null || isNetworkLink(link) || link.revokedAt !== undefined) {
    return { state: "invalid" };
  }
  if (link.ownerId === memberId) return { state: "own-link" };
  const viewer = await membershipOf(ctx, memberId);
  if (viewer !== null && viewer.householdId === link.context?.householdId) {
    return { state: "own-household" };
  }
  if (link.consumedAt !== undefined) return { state: "used", link };
  if (link.expiresAt === undefined || link.expiresAt <= now) {
    return { state: "expired", link };
  }
  if (await isBlockedEitherWay(ctx, link.ownerId, memberId)) {
    return { state: "invalid" };
  }
  const owner = await membershipOf(ctx, link.ownerId);
  if (
    owner === null ||
    owner.householdId !== link.context?.householdId ||
    owner.role !== "admin"
  ) {
    return { state: "invalid" };
  }
  if (viewer !== null) return { state: "already-in-household", link };
  return { state: "can-accept", link };
};

const REFUSALS: Record<
  Exclude<HouseholdLinkState, "can-accept">,
  { code: string; message: string }
> = {
  invalid: {
    code: "InviteLinkInvalid",
    message: "This invite link is not valid",
  },
  used: {
    code: "InviteLinkUsed",
    message: "This invite link was already used",
  },
  expired: {
    code: "InviteLinkExpired",
    message: "This invite link has expired",
  },
  "own-link": {
    code: "OwnInviteLink",
    message: "This is your own invite link",
  },
  "own-household": {
    code: "AlreadyMember",
    message: "You are already in this household",
  },
  "already-in-household": {
    code: "AlreadyInHousehold",
    message: "You are already in a household",
  },
};

// The mutations' gate: the link, when the caller may act on it; otherwise a coded refusal. A
// member already in a household may act on it only when they agreed to leave that household
// (allowAlreadyInHousehold: Accept with leaveCurrentHousehold, or Decline).
export const requireAcceptableHouseholdLink = async (
  ctx: QueryCtx,
  token: string,
  memberId: Id<"users">,
  now: number,
  allowAlreadyInHousehold = false,
): Promise<Doc<"inviteLinks">> => {
  const resolved = await resolveHouseholdLink(ctx, token, memberId, now);
  if (resolved.state === "already-in-household" && allowAlreadyInHousehold) {
    return resolved.link;
  }
  if (resolved.state !== "can-accept") {
    throw new ConvexError(REFUSALS[resolved.state]);
  }
  return resolved.link;
};

// The request-to-join gate: an expired or used household link (with its owner and household), or
// the same coded refusal as Accept for every other state. A live link refuses with InviteLinkLive:
// it can still be accepted, so there is nothing to ask.
export const requireRequestableHouseholdLink = async (
  ctx: QueryCtx,
  token: string,
  memberId: Id<"users">,
  now: number,
): Promise<Doc<"inviteLinks"> & { context: { householdId: string } }> => {
  const resolved = await resolveHouseholdLink(ctx, token, memberId, now);
  if (
    resolved.state === "can-accept" ||
    resolved.state === "already-in-household"
  ) {
    throw new ConvexError({
      code: "InviteLinkLive",
      message: "This invite link can still be accepted",
    });
  }
  if (resolved.state !== "expired" && resolved.state !== "used") {
    throw new ConvexError(REFUSALS[resolved.state]);
  }
  const { link } = resolved;
  if (link.context === undefined) throw new ConvexError(REFUSALS.invalid);
  return { ...link, context: link.context };
};
