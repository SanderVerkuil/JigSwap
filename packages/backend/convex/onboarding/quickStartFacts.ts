import type { QuickStartFacts } from "@jigswap/domain";
import type { Doc } from "../_generated/dataModel";
import type { QueryCtx } from "../_generated/server";

// Counts are read with a cap so the query stays bounded; the UI shows 51 as "50+".
const COUNT_CAP = 51;

// The member's quick start facts (spec §2.4) from their own rows, with bounded index reads. Shared
// by getQuickStart (the member's own view) and the internal activation report.
export const quickStartFactsOf = async (
  ctx: QueryCtx,
  member: Doc<"users">,
): Promise<QuickStartFacts> => {
  const me = member._id;
  const [copies, completions, follows, household, invite, profile] =
    await Promise.all([
      ctx.db
        .query("ownedPuzzles")
        .withIndex("by_owner", (q) => q.eq("ownerId", me))
        .take(COUNT_CAP),
      ctx.db
        .query("completions")
        .withIndex("by_user_completed", (q) =>
          q.eq("userId", me).eq("isCompleted", true),
        )
        .take(COUNT_CAP),
      ctx.db
        .query("follows")
        .withIndex("by_follower", (q) => q.eq("followerId", me))
        .take(COUNT_CAP),
      ctx.db
        .query("householdMembers")
        .withIndex("by_member", (q) => q.eq("memberId", me))
        .first(),
      ctx.db
        .query("householdInvites")
        .withIndex("by_invitee_status", (q) =>
          q.eq("inviteeId", me).eq("status", "pending"),
        )
        .first(),
      ctx.db
        .query("profiles")
        .withIndex("by_member", (q) => q.eq("memberId", me))
        .unique(),
    ]);
  // Only needed when the member follows nobody yet (a request to a private profile also counts).
  const pendingRequest =
    follows.length > 0
      ? null
      : await ctx.db
          .query("followRequests")
          .withIndex("by_requester", (q) => q.eq("requesterId", me))
          .filter((q) => q.eq(q.field("status"), "pending"))
          .first();

  return {
    copies: copies.length,
    completions: completions.length,
    follows: follows.length,
    pendingFollowRequests: pendingRequest ? 1 : 0,
    inHousehold: household !== null,
    pendingHouseholdInvite: invite !== null,
    hasLocation: (member.location ?? "").trim() !== "",
    visibilitySet: profile?.visibility !== undefined,
  };
};
