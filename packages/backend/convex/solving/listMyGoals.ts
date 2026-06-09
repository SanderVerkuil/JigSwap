import type { Id } from "../_generated/dataModel";
import { query } from "../_generated/server";
import { requireMember } from "../identity/requireMember";

// Read side for the goals view: the acting member's goals, newest first. Surfaces the derived
// `isAchieved` (current >= target) so the UI never recomputes it. Auth-gated.
export const listMyGoals = query({
  args: {},
  handler: async (ctx) => {
    const memberId = await requireMember(ctx);

    const rows = await ctx.db
      .query("goals")
      .withIndex("by_user", (q) =>
        q.eq("userId", memberId as unknown as Id<"users">),
      )
      .order("desc")
      .collect();

    return rows.map((row) => ({
      ...row,
      isAchieved: row.currentCompletions >= row.targetCompletions,
    }));
  },
});
