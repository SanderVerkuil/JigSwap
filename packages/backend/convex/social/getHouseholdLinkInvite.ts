import type { HouseholdLinkJoinRequestState } from "@jigswap/contracts";
import { v } from "convex/values";
import type { Doc, Id } from "../_generated/dataModel";
import { query, type QueryCtx } from "../_generated/server";
import { isOpenForRequester } from "../household/joinRequestReads";
import { memberDisplayNameOf } from "../identity/memberDisplayName";
import { requireMember } from "../identity/requireMember";
import {
  resolveHouseholdLink,
  type HouseholdLinkState,
} from "./householdLinkInvite";

// Where the member stands on asking to join through this (expired or used) link: none yet, their
// open request (a silently declined or dropped one reads the same), or closed (they used their one
// request for this link: withdrawn, approved, void or lapsed).
const joinRequestState = async (
  ctx: QueryCtx,
  link: Doc<"inviteLinks">,
  memberId: Id<"users">,
  now: number,
): Promise<HouseholdLinkJoinRequestState> => {
  const row = await ctx.db
    .query("householdJoinRequests")
    .withIndex("by_link_requester", (q) =>
      q.eq("linkId", link._id).eq("requesterId", memberId),
    )
    .first();
  if (row === null) return { status: "none" };
  return (await isOpenForRequester(ctx, row, now))
    ? {
        status: "pending",
        requestId: row.aggregateId,
        expiresAt: row.expiresAt,
      }
    : { status: "closed" };
};

// The signed-in landing for a household invite link: "<inviter> invited you to their household"
// with Accept / Decline, or why the member can't join. The inviter's name is returned only while
// the link is live (can-accept, already-in-household). An expired or used link carries
// `joinRequest` instead: whether the member may ask to join (household/requestToJoinHousehold).
// The household's own name is never returned: only its members see it (household/getMyHousehold).
export const getHouseholdLinkInvite = query({
  args: { token: v.string() },
  handler: async (
    ctx,
    { token },
  ): Promise<{
    state: HouseholdLinkState;
    inviterName?: string;
    joinRequest?: HouseholdLinkJoinRequestState;
  }> => {
    const memberId = (await requireMember(ctx)) as unknown as Id<"users">;
    const now = Date.now();
    const { state, link } = await resolveHouseholdLink(
      ctx,
      token,
      memberId,
      now,
    );
    if (link === undefined) return { state };
    if (state === "expired" || state === "used") {
      return {
        state,
        joinRequest: await joinRequestState(ctx, link, memberId, now),
      };
    }
    const inviterName = memberDisplayNameOf(await ctx.db.get(link.ownerId));
    return inviterName === undefined ? { state } : { state, inviterName };
  },
});
