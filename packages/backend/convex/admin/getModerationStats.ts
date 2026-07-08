import { ConvexError } from "convex/values";
import { query } from "../_generated/server";
import { isAdmin } from "../identity/isAdmin";
import { requireMember } from "../identity/requireMember";

const WEEK_MS = 7 * 24 * 3600 * 1000;

// KPI read model for the moderation console: this week's decision counts plus the average
// definition review time. Admin-only, gated exactly like listPendingPuzzleDefinitions.
export const getModerationStats = query({
  args: {},
  handler: async (ctx) => {
    await requireMember(ctx);
    if (!(await isAdmin(ctx))) throw new ConvexError("Forbidden");

    const since = Date.now() - WEEK_MS;
    const rows = await ctx.db
      .query("moderationActions")
      .withIndex("by_at", (q) => q.gte("at", since))
      .collect();

    let approved = 0;
    let rejected = 0;
    let flagsCleared = 0;
    const reviewMins: number[] = [];
    for (const row of rows) {
      if (
        row.kind === "definition_approved" ||
        row.kind === "definition_edited_approved"
      ) {
        approved += 1;
      } else if (row.kind === "definition_rejected") {
        rejected += 1;
      } else if (
        row.kind === "photo_restored" ||
        row.kind === "photo_removal_confirmed" ||
        row.kind === "photo_auto_rejected"
      ) {
        flagsCleared += 1;
      }
      // role_granted / role_revoked are audit-only: surfaced in the activity
      // feed, never counted in the weekly moderation KPIs.
      if (row.kind.startsWith("definition_")) {
        // Approximation: review time = decision time minus the submission's createdAt.
        // The decision row's targetId is the puzzle's Catalog aggregateId; a since-deleted
        // puzzle simply contributes no sample.
        const puzzle = await ctx.db
          .query("puzzles")
          .withIndex("by_aggregate_id", (q) =>
            q.eq("aggregateId", row.targetId),
          )
          .unique();
        if (puzzle) reviewMins.push((row.at - puzzle.createdAt) / 60_000);
      }
    }

    const avgReviewMins =
      reviewMins.length > 0
        ? Math.round(
            reviewMins.reduce((sum, mins) => sum + mins, 0) / reviewMins.length,
          )
        : null;

    return { approved, rejected, flagsCleared, avgReviewMins };
  },
});
