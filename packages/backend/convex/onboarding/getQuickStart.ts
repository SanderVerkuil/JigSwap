import type { QuickStartView } from "@jigswap/contracts";
import { deriveQuickStart } from "@jigswap/domain";
import { query } from "../_generated/server";
import { requireMemberUser } from "../whatsNew/readState";
import { onboardingRowOf, quickStartStateOf } from "./memberOnboarding";

// Counts are read with a cap so the query stays bounded; the UI shows 51 as "50+".
const COUNT_CAP = 51;

// The acting member's quick start: eligibility, welcome/card visibility and each step's status.
// "Done" is derived from the member's own rows (pure rule: deriveQuickStart); only skipped steps
// and dismissals come from memberOnboarding. Reads only the caller's own data.
export const getQuickStart = query({
  args: {},
  handler: async (ctx): Promise<QuickStartView> => {
    const member = await requireMemberUser(ctx);
    const me = member._id;
    const [row, copies, completions, follows, household, invite, profile] =
      await Promise.all([
        onboardingRowOf(ctx, me),
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

    return deriveQuickStart({
      now: Date.now(),
      accountCreatedAt: member.createdAt,
      state: quickStartStateOf(row),
      facts: {
        copies: copies.length,
        completions: completions.length,
        follows: follows.length,
        pendingFollowRequests: pendingRequest ? 1 : 0,
        inHousehold: household !== null,
        pendingHouseholdInvite: invite !== null,
        hasLocation: (member.location ?? "").trim() !== "",
        visibilitySet: profile?.visibility !== undefined,
      },
    });
  },
});
