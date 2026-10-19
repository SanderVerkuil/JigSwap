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
// - "used" / "expired": single use and the 14-day expiry, checked server-side;
// - "own-link": the inviter opened their own link;
// - "already-in-household": the one-household rule (no Accept is offered);
// - "can-accept": everything above passed.
export type HouseholdLinkState =
  | "can-accept"
  | "already-in-household"
  | "own-link"
  | "expired"
  | "used"
  | "invalid";

// The link is returned only while it is live for this member (can-accept, already-in-household).
export type HouseholdLinkResolution =
  | {
      state: "can-accept" | "already-in-household";
      link: Doc<"inviteLinks">;
    }
  | {
      state: Exclude<HouseholdLinkState, "can-accept" | "already-in-household">;
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
  if (link.consumedAt !== undefined) return { state: "used" };
  if (link.expiresAt === undefined || link.expiresAt <= now) {
    return { state: "expired" };
  }
  if (link.ownerId === memberId) return { state: "own-link" };
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
  if ((await membershipOf(ctx, memberId)) !== null) {
    return { state: "already-in-household", link };
  }
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
