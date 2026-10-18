import { paginationOptsValidator } from "convex/server";
import { ConvexError } from "convex/values";
import type { Id } from "../_generated/dataModel";
import { query } from "../_generated/server";
import { isAdmin } from "../identity/isAdmin";
import { requireMember } from "../identity/requireMember";
import schema from "../schema";
import { adminLabelOf, reportsAgainst, targetSummaryOf } from "./reportViews";

// The admin report queue (spec 2.5): reports in one status, newest first, each with the
// reporter's and reported member's labels, the reason, a target summary and how many OPEN
// reports the reported member has. Admin-only, gated exactly like listRejectedPhotos.
export const listReports = query({
  args: {
    status: schema.tables.reports.validator.fields.status,
    paginationOpts: paginationOptsValidator,
  },
  handler: async (ctx, args) => {
    await requireMember(ctx);
    if (!(await isAdmin(ctx))) throw new ConvexError("Forbidden");

    const result = await ctx.db
      .query("reports")
      .withIndex("by_status_created", (q) => q.eq("status", args.status))
      .order("desc")
      .paginate(args.paginationOpts);

    const openCounts = new Map<Id<"users">, Promise<number>>();
    const openCountOf = (userId: Id<"users">) => {
      let count = openCounts.get(userId);
      if (!count) {
        count = reportsAgainst(ctx, userId).then(
          (rows) => rows.filter((row) => row.status === "open").length,
        );
        openCounts.set(userId, count);
      }
      return count;
    };

    return {
      ...result,
      page: await Promise.all(
        result.page.map(async (report) => ({
          reportId: report._id,
          targetKind: report.targetKind,
          targetId: report.targetId,
          reason: report.reason,
          status: report.status,
          ...(report.decision !== undefined
            ? { decision: report.decision }
            : {}),
          createdAt: report.createdAt,
          reporterLabel: await adminLabelOf(ctx, report.reporterId),
          reportedUserId: report.reportedUserId,
          reportedLabel: await adminLabelOf(ctx, report.reportedUserId),
          targetSummary: await targetSummaryOf(ctx, report),
          openReportsAgainstReported: await openCountOf(report.reportedUserId),
        })),
      ),
    };
  },
});
