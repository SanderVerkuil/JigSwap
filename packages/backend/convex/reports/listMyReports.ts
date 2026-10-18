import type { Doc, Id } from "../_generated/dataModel";
import { query } from "../_generated/server";
import { requireMember } from "../identity/requireMember";

/** How many of the caller's reports the list returns (newest first). */
export const MY_REPORTS_LIMIT = 50;

// The caller's own reports, newest first, with their status and decision so the UI can show a
// target as "reported" / "handled". Carries nothing about the reported member beyond the target
// reference the reporter already held; the statement of reasons is the reported member's notice.
export const listMyReports = query({
  args: {},
  handler: async (ctx) => {
    const reporterId = (await requireMember(ctx)) as unknown as Id<"users">;
    const rows = await ctx.db
      .query("reports")
      .withIndex("by_reporter_created", (q) => q.eq("reporterId", reporterId))
      .order("desc")
      .take(MY_REPORTS_LIMIT);
    return rows.map((row: Doc<"reports">) => ({
      reportId: row._id,
      targetKind: row.targetKind,
      targetId: row.targetId,
      reason: row.reason,
      status: row.status,
      ...(row.decision !== undefined ? { decision: row.decision } : {}),
      createdAt: row.createdAt,
      ...(row.decidedAt !== undefined ? { decidedAt: row.decidedAt } : {}),
    }));
  },
});
