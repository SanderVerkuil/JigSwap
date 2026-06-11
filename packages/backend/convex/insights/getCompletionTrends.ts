import { computeCompletionTrends } from "@jigswap/domain";
import type { Id } from "../_generated/dataModel";
import { query } from "../_generated/server";
import { requireMember } from "../identity/requireMember";

// Insights read query: the member's completions per month over the last ~12 months, for the trend
// chart. Only finished solves (with an endDate) contribute; the timestamp is the solve's endDate.
export const getCompletionTrends = query({
  args: {},
  handler: async (ctx) => {
    const memberId = await requireMember(ctx);
    const userId = memberId as unknown as Id<"users">;

    const completions = await ctx.db
      .query("completions")
      .withIndex("by_user", (q) => q.eq("userId", userId))
      .collect();

    const finished = completions.filter(
      (c): c is typeof c & { endDate: number } =>
        c.isCompleted && typeof c.endDate === "number",
    );

    return computeCompletionTrends(
      finished.map((c) => ({
        completedAt: c.endDate,
        completionTimeMinutes: c.completionTimeMinutes,
      })),
    );
  },
});
