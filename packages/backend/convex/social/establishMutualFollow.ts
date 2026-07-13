import { COOLDOWN_MS, makeFollowMember, toMemberId } from "@jigswap/domain";
import { Id } from "../_generated/dataModel";
import { MutationCtx } from "../_generated/server";
import { convexFollowRepository } from "./adapters/convexFollowRepository";
import { followIdGenerator } from "./adapters/idGenerators";
import { inProcessEventPublisher } from "./adapters/inProcessEventPublisher";
import { systemClock } from "./adapters/systemClock";

// What establishMutualFollow did, so callers can bookkeep truthfully:
// - established: false ONLY when the decline-cooldown gate refused (no edges, no row flips).
// - edgesCreated: count of NEWLY created follow edges (0..2); 0 means both already existed
//   (an already-mutual repeat), so callers must NOT bump their "follows established" counter.
export type EstablishMutualFollowResult = {
  established: boolean;
  edgesCreated: number;
};

// Establish follow edges in BOTH directions between two members, tolerating edges that already
// exist, and resolve any RESOLVABLE follow request between the pair. Used by QR scan + invite
// redemption — these flows bypass the private-profile request gate that the followMember ENDPOINT
// applies (Phase 2). Consent-verification (the decline cooldown) is enforced HERE, structurally,
// so every caller is protected: Convex mutations are public endpoints, and a forwarded invite
// token in an existing member's hands must not become a way to bypass a decline. It still goes
// through the domain use case so MemberFollowed events reach the activity feed and notifications.
export async function establishMutualFollow(
  ctx: MutationCtx,
  a: Id<"users">,
  b: Id<"users">,
): Promise<EstablishMutualFollowResult> {
  const now = Date.now();

  // Anti-pester invariant (Phase 2), enforced structurally for ALL callers: while a decline of
  // EITHER party against the other is inside its cooldown, NO token path may force a connection.
  // Tokens are forwardable (share button, copyable URL), so possession is not in-person consent.
  // A genuinely new member (redeemInvite's real case) has no prior request rows and never trips
  // this. Refuse cleanly: create no edges, flip no rows, and report established:false.
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
      request.status === "declined" &&
      request.respondedAt !== undefined &&
      now - request.respondedAt < COOLDOWN_MS
    ) {
      return { established: false, edgesCreated: 0 };
    }
  }

  const followMemberUseCase = makeFollowMember({
    follows: convexFollowRepository(ctx),
    followIds: followIdGenerator,
    events: inProcessEventPublisher(ctx),
    clock: systemClock,
  });

  let edgesCreated = 0;
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
    } else {
      edgesCreated += 1;
    }
  }

  // Consistency bookkeeping once the edges legitimately exist: a stale "pending" row would keep
  // the requester's UI stuck on "Requested", and a declined row whose cooldown has EXPIRED no
  // longer protects anyone — flip both to approved. (In-cooldown declines already returned above,
  // so they can never reach here.) Mark the flip as token-driven so the Notifications subscriber
  // does NOT suppress the target's new_follower: the target never clicked "approve" here (S1).
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
        approvedViaToken: true,
      });
    }
  }

  return { established: true, edgesCreated };
}
