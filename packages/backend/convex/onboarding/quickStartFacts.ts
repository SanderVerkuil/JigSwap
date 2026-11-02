import {
  readsAsPendingToRequester,
  type QuickStartFacts,
} from "@jigswap/domain";
import type { Doc, Id } from "../_generated/dataModel";
import type { QueryCtx } from "../_generated/server";
import { isOpenHouseholdInvite } from "../household/memberships";

// Counts are read with a cap so the query stays bounded; the UI shows 51 as "50+".
const COUNT_CAP = 51;

// Pending household invites the quick start looks at, newest first. Lapsed ones stay pending
// (lapsing is computed, never stored), so the read is capped; an open invite is under 14 days old,
// so newest first it sits ahead of every lapsed one.
const PENDING_INVITE_SCAN_CAP = 20;

// Whether the member has a household invite they can still accept (isOpenHouseholdInvite: not
// lapsed, its inviter still the admin, no block either way), among their newest
// PENDING_INVITE_SCAN_CAP pending ones.
const hasPendingHouseholdInvite = async (
  ctx: QueryCtx,
  me: Id<"users">,
): Promise<boolean> => {
  const now = Date.now();
  const pending = await ctx.db
    .query("householdInvites")
    .withIndex("by_invitee_status", (q) =>
      q.eq("inviteeId", me).eq("status", "pending"),
    )
    .order("desc")
    .take(PENDING_INVITE_SCAN_CAP);
  for (const invite of pending) {
    if (await isOpenHouseholdInvite(ctx, invite, now)) return true;
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
  // The household's size only when in one: a household of one reads "just you so far".
  const [pendingRequest, householdMembers] = await Promise.all([
    follows.length > 0 ? false : hasRequestReadingAsPending(ctx, me),
    household === null
      ? []
      : ctx.db
          .query("householdMembers")
          .withIndex("by_household", (q) =>
            q.eq("householdId", household.householdId),
          )
          .take(COUNT_CAP),
  ]);

  return {
    copies: copies.length,
    completions: completions.length,
    follows: follows.length,
    pendingFollowRequests: pendingRequest ? 1 : 0,
    inHousehold: household !== null,
    householdMembers: householdMembers.length,
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
