import { COOLDOWN_MS, makeFollowMember, toMemberId } from "@jigswap/domain";
import { Id } from "../_generated/dataModel";
import { MutationCtx } from "../_generated/server";
import { convexFollowRepository } from "./adapters/convexFollowRepository";
import { followIdGenerator } from "./adapters/idGenerators";
import { inProcessEventPublisher } from "./adapters/inProcessEventPublisher";
import { systemClock } from "./adapters/systemClock";

// Establish follow edges in BOTH directions between two members, tolerating edges that already
// exist, and resolve any RESOLVABLE follow request between the pair. Used by QR scan + invite
// redemption — these flows bypass the private-profile request gate that the followMember ENDPOINT
// applies (Phase 2), so callers are responsible for verifying consent first (in particular the
// decline cooldown; see acceptQrFollow). It still goes through the domain use case so
// MemberFollowed events reach the activity feed and notifications.
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

  // Consistency bookkeeping once the edges legitimately exist: a stale "pending" row would keep
  // the requester's UI stuck on "Requested", and a declined row whose cooldown has EXPIRED no
  // longer protects anyone — flip both to approved. In-cooldown declines are NEVER overridden by
  // token flows (tokens are forwardable, so possession is not consent); callers must gate on the
  // cooldown BEFORE calling this helper, as acceptQrFollow does.
  const now = Date.now();
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
      (request.status === "pending" ||
        (request.status === "declined" &&
          (request.respondedAt === undefined ||
            now - request.respondedAt >= COOLDOWN_MS)))
    ) {
      await ctx.db.patch(request._id, {
        status: "approved",
        respondedAt: now,
      });
    }
  }
}
