import type { CircleDetailView } from "@jigswap/contracts";
import { v } from "convex/values";
import type { Id } from "../_generated/dataModel";
import { query } from "../_generated/server";
import { requireMember } from "../identity/requireMember";
import { toCircleDetail } from "./readViews";

// Sharing read: one circle with its resolved members. Visibility is gated to circle members only
// (a circle is a private group); a non-member sees null. `circleId` is the domain CircleId.
export const getCircle = query({
  args: { circleId: v.string() },
  handler: async (ctx, args): Promise<CircleDetailView | null> => {
    const viewerId = (await requireMember(ctx)) as unknown as Id<"users">;

    const row = await ctx.db
      .query("circles")
      .withIndex("by_aggregate_id", (q) => q.eq("aggregateId", args.circleId))
      .unique();
    if (!row) return null;

    // Only members may see a circle's contents.
    if (!row.memberships.some((m) => m.memberId === viewerId)) return null;

    return toCircleDetail(ctx, row, viewerId);
  },
});
