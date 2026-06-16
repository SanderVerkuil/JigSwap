import type { CopyId, CopyReservationPort } from "@jigswap/domain";
import type { Id } from "../../_generated/dataModel";
import type { QueryCtx } from "../../_generated/server";

// Active-exchange statuses that reserve a copy: a proposed or accepted exchange is "in flight"
// and the copy may not be re-offered until it resolves (rejected/cancelled/completed/disputed
// release it). Mirrors the Exchange context's notion of an in-progress deal.
const ACTIVE_STATUSES = new Set(["proposed", "accepted"]);

// Driven adapter for the CopyReservationPort: the cross-context seam to Exchange. The Library
// asks "is this copy reserved?" instead of knowing about the `exchanges` table shape. The
// domain CopyId is the copy's aggregateId; exchanges reference copies by Convex _id, so resolve
// first, then check whether any active exchange offers/requests it.
export const convexCopyReservationPort = (
  ctx: QueryCtx,
): CopyReservationPort => ({
  async isReserved(copyId: CopyId): Promise<boolean> {
    const copy = await ctx.db
      .query("ownedPuzzles")
      .withIndex("by_aggregate_id", (q) =>
        q.eq("aggregateId", copyId as string),
      )
      .unique();
    if (!copy) return false;
    const ownedPuzzleId = copy._id as Id<"ownedPuzzles">;

    // Indexed lookup of exchanges that reference the copy as requested or offered (union of the
    // two indexes), then keep only those in an active status — no full-table scan.
    const [asRequested, asOffered] = await Promise.all([
      ctx.db
        .query("exchanges")
        .withIndex("by_requested_copy", (q) =>
          q.eq("requestedPuzzleId", ownedPuzzleId),
        )
        .collect(),
      ctx.db
        .query("exchanges")
        .withIndex("by_offered_copy", (q) =>
          q.eq("offeredPuzzleId", ownedPuzzleId),
        )
        .collect(),
    ]);
    return [...asRequested, ...asOffered].some((ex) =>
      ACTIVE_STATUSES.has(ex.status),
    );
  },
});
