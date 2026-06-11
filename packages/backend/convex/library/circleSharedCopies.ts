import type { OwnerId } from "@jigswap/domain";
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
export const collectCircleSharedCopies = async (
  ctx: QueryCtx,
  viewerId: Id<"users">,
): Promise<Doc<"ownedPuzzles">[]> => {
  const circles = convexCircleRepository(ctx);
  const viewer = toMemberId(viewerId);
  const myCircles = await circles.listForMember(viewer);
  if (myCircles.length === 0) return [];

  // Resolve every copy shared into any of the viewer's circles (by CopyId aggregateId), keeping the
  // owned-copy row alongside its domain aggregate for the policy check.
  const copyAggregateIds = new Set<string>();
  for (const circle of myCircles) {
    const shares = await ctx.db
      .query("circleCopyShares")
      .withIndex("by_circle", (q) => q.eq("circleId", circle.id as string))
      .collect();
    for (const share of shares) copyAggregateIds.add(share.copyId);
  }
  if (copyAggregateIds.size === 0) return [];

  // The copy repository only reads here (findById); a QueryCtx is structurally sufficient.
  const copyRepo = convexCopyRepository(ctx as unknown as MutationCtx);
  const resolved = await Promise.all(
    [...copyAggregateIds].map(async (copyId) => {
      const row = await ctx.db
        .query("ownedPuzzles")
        .withIndex("by_aggregate_id", (q) => q.eq("aggregateId", copyId))
        .unique();
      if (!row) return null;
      const copy = await copyRepo.findById(toCopyId(copyId));
      return copy ? { row, copy } : null;
    }),
  );
  const candidates = resolved.filter((r) => r !== null);
  if (candidates.length === 0) return [];

  // Build the circle-aware policy once for the viewer against the distinct owners in play.
  const owner = (id: Id<"users">): OwnerId => toOwnerId(id);
  const policy = await makeCircleAwareVisibilityPolicy(
    ctx,
    owner(viewerId),
    candidates.map((c) => c.copy.ownerId),
  );

  return candidates
    .filter((c) => policy.canView(owner(viewerId), c.copy))
    .map((c) => c.row);
};
