import { v } from "convex/values";
import { internal } from "../_generated/api";
import type { Id } from "../_generated/dataModel";
import { internalMutation, type MutationCtx } from "../_generated/server";

// Report retention (spec 2.8): a report is kept 12 months after its decision, then purged: the
// reporter is anonymised (reporterId and the notice's name and email go), and the reporter's
// details and the evidence snapshot's message bodies are cleared. The row stays (target, reason,
// decision and statement of reasons) as the record of the decision; nothing in it names the
// reporter or quotes the conversation any more. The removal evidence copy has its own, shorter
// purge (reports/attachmentEvidence, 6 months).
//
// Scheduled per report at its decision (admin/decideReport) with scheduler.runAt, like the
// evidence purge: durable across deploys, exact to the report, no cron sweep needed.
// [LAWYER] There is no law-enforcement escalation flag on reports yet; when one is added, an
// escalated report must be exempt here ("longer only when escalated", spec 2.8).

/** When a decided report is purged: twelve calendar months after the decision. */
export const reportRetainUntil = (decidedAt: number): number => {
  const until = new Date(decidedAt);
  until.setUTCMonth(until.getUTCMonth() + 12);
  return until.getTime();
};

/** Schedule the retention purge of a report decided at `decidedAt`. */
export const scheduleReportRetention = async (
  ctx: MutationCtx,
  reportId: Id<"reports">,
  decidedAt: number,
): Promise<void> => {
  await ctx.scheduler.runAt(
    reportRetainUntil(decidedAt),
    internal.reports.retention.purgeReport,
    { reportId },
  );
};

export const purgeReport = internalMutation({
  args: { reportId: v.id("reports") },
  handler: async (ctx, { reportId }) => {
    const report = await ctx.db.get(reportId);
    if (
      !report ||
      report.decidedAt === undefined ||
      report.retentionPurgedAt !== undefined
    ) {
      return;
    }
    const retainUntil = reportRetainUntil(report.decidedAt);
    if (retainUntil > Date.now()) {
      await scheduleReportRetention(ctx, reportId, report.decidedAt);
      return;
    }
    const now = Date.now();
    await ctx.db.patch(reportId, {
      reporterId: undefined,
      reporterAnonymisedAt: report.reporterAnonymisedAt ?? now,
      details: undefined,
      ...(report.illegalNotice && {
        illegalNotice: { goodFaith: report.illegalNotice.goodFaith },
      }),
      evidence: {
        ...(report.evidence.messages && {
          messages: report.evidence.messages.map((message) => ({
            ...message,
            body: "",
          })),
        }),
      },
      retentionPurgedAt: now,
    });
  },
});
