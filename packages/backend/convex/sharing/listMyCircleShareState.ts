import { SharingApplicationError, toCircleId } from "@jigswap/domain";
import { v } from "convex/values";
import type { Id } from "../_generated/dataModel";
import { query } from "../_generated/server";
import { requireMember } from "../identity/requireMember";
import { isCopySharedInto } from "./adapters/circleCopyShares";
import { circleByAggregateId } from "./circleAccess";
import { toConvexError } from "./errors";

/** The most of the viewer's own copies (newest first) one read probes. */
export const SHARE_STATE_SCAN_CAP = 500;

// Which of the viewer's OWN copies are shared into the circle, as their Library CopyIds, for the
// circle page's share picker (ticked = shared). Members only: a non-member and an unknown circle
// get the same CircleNotFound. Never lists anyone else's copies. Works from the viewer's library
// (one point probe per copy, like withdrawMemberShares), so the cost scales with what they own,
// bounded by SHARE_STATE_SCAN_CAP: an older copy past it reads as not shared, and re-sharing it is
// harmless (shareCopiesToCircle counts it as already shared).
export const listMyCircleShareState = query({
  args: { circleId: v.string() },
  handler: async (ctx, args): Promise<string[]> => {
    const viewerId = (await requireMember(ctx)) as unknown as Id<"users">;
    const circle = await circleByAggregateId(ctx, args.circleId);
    if (!circle || !circle.memberships.some((m) => m.memberId === viewerId)) {
      throw toConvexError(
        SharingApplicationError.circleNotFound(toCircleId(args.circleId)),
      );
    }

    const copies = await ctx.db
      .query("ownedPuzzles")
      .withIndex("by_owner", (q) => q.eq("ownerId", viewerId))
      .order("desc")
      .take(SHARE_STATE_SCAN_CAP);

    const shared: string[] = [];
    for (const copy of copies) {
      // Legacy rows without an aggregate id can't have been shared.
      if (!copy.aggregateId) continue;
      if (await isCopySharedInto(ctx, args.circleId, copy.aggregateId)) {
        shared.push(copy.aggregateId);
      }
    }
    return shared;
  },
});
