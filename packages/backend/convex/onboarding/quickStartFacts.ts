import {
  readsAsPendingToRequester,
  type QuickStartFacts,
} from "@jigswap/domain";
import type { Doc, Id } from "../_generated/dataModel";
import type { QueryCtx } from "../_generated/server";
import { isLapsedHouseholdInvite } from "../household/memberships";

// Counts are read with a cap so the query stays bounded; the UI shows 51 as "50+".
const COUNT_CAP = 51;

// Whether the member has a pending household invite that has not lapsed. Stops at the first one.
const hasPendingHouseholdInvite = async (
  ctx: QueryCtx,
  me: Id<"users">,
): Promise<boolean> => {
  const now = Date.now();
  const pending = ctx.db
    .query("householdInvites")
    .withIndex("by_invitee_status", (q) =>
      q.eq("inviteeId", me).eq("status", "pending"),
    );
  for await (const invite of pending) {
    if (!isLapsedHouseholdInvite(invite, now)) return true;
  }
  return false;
};

// The member's quick start facts (spec §2.4) from their own rows, with bounded index reads. Shared
// by getQuickStart (the member's own view) and the internal activation report.
export const quickStartFactsOf = async (
  ctx: QueryCtx,
  member: Doc<"users">,
): Promise<QuickStartFacts> => {
  const me = member._id;
  const [copies, completions, follows, household, pendingInvite, profile] =
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
      hasPendingHouseholdInvite(ctx, me),
      ctx.db
        .query("profiles")
        .withIndex("by_member", (q) => q.eq("memberId", me))
        .unique(),
    ]);
  // Only needed when the member follows nobody yet (a request to a private profile also counts).
  // A request counts as pending exactly when the member's own follow button says so: a silently
  // declined one still does, so this step can't reveal a decline (SEC-39).
  const pendingRequest =
    follows.length > 0 ? false : await hasRequestReadingAsPending(ctx, me);

  return {
    copies: copies.length,
    completions: completions.length,
    follows: follows.length,
    pendingFollowRequests: pendingRequest ? 1 : 0,
    inHousehold: household !== null,
    pendingHouseholdInvite: pendingInvite,
    hasLocation: (member.location ?? "").trim() !== "",
    visibilitySet: profile?.visibility !== undefined,
  };
};

// Whether any follow request the member sent reads to them as pending. Walks their requests
// until the first match, like the status filter this replaced.
const hasRequestReadingAsPending = async (
  ctx: QueryCtx,
  me: Id<"users">,
): Promise<boolean> => {
  const now = Date.now();
  for await (const request of ctx.db
    .query("followRequests")
    .withIndex("by_requester", (q) => q.eq("requesterId", me))) {
    if (readsAsPendingToRequester(request, now)) return true;
  }
  return false;
};
