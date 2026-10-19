import { MAX_CIRCLE_MEMBERS } from "@jigswap/domain";
import type { Doc, Id } from "../_generated/dataModel";
import type { QueryCtx } from "../_generated/server";
import { householdMateIds } from "../household/memberships";
import { isOpen } from "../library/canViewCopy";
import { isCopyPrivate } from "../library/copyVisibility";
import { blockedEitherWaySet } from "../social/blocks";
import { areMutualFollowers, profileVisibilityOf } from "../social/privacy";
import { circleRowOf } from "./readModelHelpers";

/**
 * Who in the circle may see an attached copy: `everyone` (every current co-member not blocked
 * either way with the author) or `some` (at least one of them, not all).
 */
export type CircleCopyAudience = "everyone" | "some";

/**
 * The circle-thread attach rule, shared by postMessage's gate and listAttachableCopies so the
 * picker offers exactly what a post accepts. `authorId` must already be a CURRENT member of the
 * thread's circle (both callers check that first). Returns the copy's audience, or null when it
 * can't be attached. A copy is attachable iff the author OWNS it and at least one co-member may
 * view it:
 *   1. Whole circle (`everyone`, no per-member work): the copy is OPEN and either the author's
 *      profile is public, or it is shared into THIS circle (circleCopyShares.by_circle_copy) and the
 *      circle exists. Then canViewCopy's rule 3 or 4 holds for every co-member.
 *   2. Per member: each current co-member M is evaluated once against the author's standing links,
 *      canViewCopy's rules 5 and 6: M is in the author's household (sees any copy), or M and the
 *      author follow each other (sees any copy that isn't private). `everyone` when that covers all
 *      co-members, `some` when it covers at least one, null when it covers none.
 *
 * Bounded: the per-member links are read once per evaluator (≤ MAX_CIRCLE_MEMBERS members: one
 * mutual-follow probe each, plus the author's household and blocks), then each copy costs O(1).
 * Calling canViewCopy per member per copy would not fit the picker's scan (up to 500 copies x 49
 * members) in a query's read budget. The rule IMPLIES canViewCopy for every member it counts; it is
 * deliberately stricter otherwise: a member who could see the copy only by holding it (heldBy),
 * through an exchange (rule P) or through a share into some OTHER circle is not counted, so such a
 * copy may be `some` or not offered.
 *
 * Partial audiences are allowed: every card is re-checked per viewer at read time
 * (threadMessageViewOf -> canViewCopy), so a member who may not see the copy gets the
 * "isn't available to you" placeholder, which carries nothing of the copy.
 *
 * A co-member blocked either way with the author is left out entirely (neither a viewer nor counted
 * against `everyone`): anything else would tell the author about a block they must not learn of.
 * That member gets the placeholder too.
 */
export const circleCopyAudience = (
  ctx: QueryCtx,
  thread: Doc<"threads">,
  authorId: Id<"users">,
) => {
  const circleId = thread.circleId;
  let ready: Promise<{ authorPublic: boolean; circleExists: boolean }> | null =
    null;
  let links: Promise<{
    coMembers: number;
    household: number;
    mutualOnly: number;
  }> | null = null;

  const readLinks = async () => {
    if (circleId === undefined) {
      return { coMembers: 0, household: 0, mutualOnly: 0 };
    }
    const [seats, blocked, mates] = await Promise.all([
      ctx.db
        .query("circleMembers")
        .withIndex("by_circle", (q) => q.eq("circleAggregateId", circleId))
        .take(MAX_CIRCLE_MEMBERS),
      blockedEitherWaySet(ctx, authorId),
      householdMateIds(ctx, authorId),
    ]);
    let coMembers = 0;
    let household = 0;
    let mutualOnly = 0;
    for (const { memberId } of seats) {
      if (memberId === authorId || blocked.has(memberId)) continue;
      coMembers += 1;
      if (mates.has(memberId)) household += 1;
      else if (await areMutualFollowers(ctx, authorId, memberId)) {
        mutualOnly += 1;
      }
    }
    return { coMembers, household, mutualOnly };
  };

  return async (
    copy: Doc<"ownedPuzzles">,
  ): Promise<CircleCopyAudience | null> => {
    if (circleId === undefined || copy.ownerId !== authorId) return null;
    ready ??= (async () => ({
      authorPublic: (await profileVisibilityOf(ctx, authorId)) === "public",
      circleExists: (await circleRowOf(ctx, circleId)) !== null,
    }))();
    const { authorPublic, circleExists } = await ready;
    if (!circleExists) return null;
    if (isOpen(copy)) {
      if (authorPublic) return "everyone";
      const copyId = copy.aggregateId;
      if (
        copyId !== undefined &&
        (await ctx.db
          .query("circleCopyShares")
          .withIndex("by_circle_copy", (q) =>
            q.eq("circleId", circleId).eq("copyId", copyId),
          )
          .first()) !== null
      ) {
        return "everyone";
      }
    }
    links ??= readLinks();
    const { coMembers, household, mutualOnly } = await links;
    const viewers = household + (isCopyPrivate(copy) ? 0 : mutualOnly);
    if (viewers === 0) return null;
    return viewers === coMembers ? "everyone" : "some";
  };
};
