import type { CircleId, OwnerId } from "@jigswap/domain";
import { toCopyId, toMemberId, toOwnerId } from "@jigswap/domain";
import type { Doc, Id } from "../_generated/dataModel";
import type { MutationCtx, QueryCtx } from "../_generated/server";
import { convexCircleRepository } from "../sharing/adapters/convexCircleRepository";
import { makeCircleAwareVisibilityPolicy } from "./adapters/circleAwareVisibilityPolicy";
import { convexCopyRepository } from "./adapters/convexCopyRepository";

// Cross-context read helper: the owned-copy rows shared into a circle the viewer belongs to AND that
// the circle-aware VisibilityPolicy says the viewer may see. Loads each shared copy as a domain
// aggregate, runs it through the policy (which delegates to Sharing's pure VisibilityPolicy), and
// returns the surviving rows for the browse union. Returns [] when the viewer is in no circle.
//
// A share only counts via a circle that (a) has a circleCopyShares row for THIS copy, (b) the viewer
// is currently a member of and (c) the copy's owner is currently a member of — membership meaning a
// `circleMembers` junction row, never a pending invite (#181). A copy with no such circle is dropped
// (so a stale share left behind after the owner left the circle exposes nothing), and the policy gets
// exactly those per-copy circles, never just any circle the viewer and owner happen to share.
export const collectCircleSharedCopies = async (
  ctx: QueryCtx,
  viewerId: Id<"users">,
): Promise<Doc<"ownedPuzzles">[]> => {
  const circles = convexCircleRepository(ctx);
  const viewer = toMemberId(viewerId);
  const myCircles = await circles.listForMember(viewer);
  if (myCircles.length === 0) return [];

  // Resolve every copy shared into any of the viewer's circles (by CopyId aggregateId), remembering
  // which of the viewer's circles each copy was shared into.
  const sharedInto = new Map<string, CircleId[]>();
  for (const circle of myCircles) {
    const shares = await ctx.db
      .query("circleCopyShares")
      .withIndex("by_circle", (q) => q.eq("circleId", circle.id as string))
      .collect();
    for (const share of shares) {
      const into = sharedInto.get(share.copyId) ?? [];
      into.push(circle.id);
      sharedInto.set(share.copyId, into);
    }
  }
  if (sharedInto.size === 0) return [];

  // The copy repository only reads here (findById); a QueryCtx is structurally sufficient.
  const copyRepo = convexCopyRepository(ctx as unknown as MutationCtx);
  const resolved = await Promise.all(
    [...sharedInto].map(async ([copyId, into]) => {
      const row = await ctx.db
        .query("ownedPuzzles")
        .withIndex("by_aggregate_id", (q) => q.eq("aggregateId", copyId))
        .unique();
      if (!row) return null;
      // Keep only the circles the copy's owner is still a member of (junction probe per circle).
      const ownerIn = await Promise.all(
        into.map(async (circleId) =>
          (await ctx.db
            .query("circleMembers")
            .withIndex("by_circle_member", (q) =>
              q
                .eq("circleAggregateId", circleId as string)
                .eq("memberId", row.ownerId),
            )
            .first()) !== null
            ? circleId
            : null,
        ),
      );
      const qualifying = ownerIn.filter((c) => c !== null);
      if (qualifying.length === 0) return null;
      const copy = await copyRepo.findById(toCopyId(copyId));
      return copy ? { row, copy, qualifying } : null;
    }),
  );
  const candidates = resolved.filter((r) => r !== null);
  if (candidates.length === 0) return [];

  // The policy sees, per copy, exactly the qualifying circles resolved above.
  const owner = (id: Id<"users">): OwnerId => toOwnerId(id);
  const circlesByCopy = new Map(
    candidates.map((c) => [c.copy.id as string, c.qualifying]),
  );
  const policy = makeCircleAwareVisibilityPolicy(
    (copy) => circlesByCopy.get(copy.id as string) ?? [],
  );

  return candidates
    .filter((c) => policy.canView(owner(viewerId), c.copy))
    .map((c) => c.row);
};
