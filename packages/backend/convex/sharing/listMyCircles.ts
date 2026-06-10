import type { CircleSummaryView } from "@jigswap/contracts";
import { query } from "../_generated/server";
import { requireMember } from "../identity/requireMember";
import { toCircleSummary } from "./readViews";
import type { Id } from "../_generated/dataModel";

// Sharing read: the signed-in member's circles (every circle they belong to), newest first. Member
// lookup goes through the `circleMembers` projection so it's an indexed read.
export const listMyCircles = query({
  args: {},
  handler: async (ctx): Promise<CircleSummaryView[]> => {
    const memberId = (await requireMember(ctx)) as unknown as Id<"users">;

    const links = await ctx.db
      .query("circleMembers")
      .withIndex("by_member", (q) => q.eq("memberId", memberId))
      .collect();

    const rows = await Promise.all(
      links.map((link) =>
        ctx.db
          .query("circles")
          .withIndex("by_aggregate_id", (q) =>
            q.eq("aggregateId", link.circleAggregateId),
          )
          .unique(),
      ),
    );

    return rows
      .filter((row) => row !== null)
      .sort((a, b) => b.createdAt - a.createdAt)
      .map((row) => toCircleSummary(row, memberId));
  },
});
