import { makeFollowMember, toMemberId } from "@jigswap/domain";
import { Id } from "../_generated/dataModel";
import { MutationCtx } from "../_generated/server";
import { convexFollowRepository } from "./adapters/convexFollowRepository";
import { followIdGenerator } from "./adapters/idGenerators";
import { inProcessEventPublisher } from "./adapters/inProcessEventPublisher";
import { systemClock } from "./adapters/systemClock";

// Establish follow edges in BOTH directions between two members, tolerating edges that already
// exist, and resolve any outstanding follow request between the pair. Used by QR scan + invite
// redemption, where physically sharing your code is mutual intent — so this deliberately bypasses
// the private-profile request gate that the followMember ENDPOINT applies (Phase 2). It still goes
// through the domain use case so MemberFollowed events reach the activity feed and notifications.
export async function establishMutualFollow(
  ctx: MutationCtx,
  a: Id<"users">,
  b: Id<"users">,
): Promise<void> {
  const followMemberUseCase = makeFollowMember({
    follows: convexFollowRepository(ctx),
    followIds: followIdGenerator,
    events: inProcessEventPublisher(ctx),
    clock: systemClock,
  });

  for (const [follower, followee] of [
    [a, b],
    [b, a],
  ] as const) {
    // Skip directions that already have an edge (the use case would reject the duplicate).
    const existing = await ctx.db
      .query("follows")
      .withIndex("by_follower_followee", (q) =>
        q.eq("followerId", follower).eq("followeeId", followee),
      )
      .unique();
    if (existing !== null) continue;

    const result = await followMemberUseCase({
      followerId: toMemberId(follower),
      followeeId: toMemberId(followee),
    });
    // Duplicate-edge races are benign here; anything else (e.g. self-follow) is a caller bug.
    if (result.isErr) {
      console.warn("establishMutualFollow: follow rejected", result.error);
    }
  }

  // Resolve any outstanding request between the pair — the edge now exists either way, and a stale
  // "pending" row would keep the requester's UI stuck on "Requested". A prior DECLINE is also
  // cleared here: physically sharing your QR (or redeeming an invite) is explicit mutual intent that
  // overrides a past decline-in-cooldown, so the requester is no longer blocked.
  for (const [requesterId, targetId] of [
    [a, b],
    [b, a],
  ] as const) {
    const request = await ctx.db
      .query("followRequests")
      .withIndex("by_requester_target", (q) =>
        q.eq("requesterId", requesterId).eq("targetId", targetId),
      )
      .unique();
    if (
      request !== null &&
      (request.status === "pending" || request.status === "declined")
    ) {
      await ctx.db.patch(request._id, {
        status: "approved",
        respondedAt: Date.now(),
      });
    }
  }
}
