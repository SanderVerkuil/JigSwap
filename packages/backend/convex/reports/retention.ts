import { v } from "convex/values";
import { internal } from "../_generated/api";
import type { Id } from "../_generated/dataModel";
import { internalMutation, type MutationCtx } from "../_generated/server";
import {
  DAY_MS,
  logRetentionSweep,
  RETENTION_SWEEP_PAGE,
  retentionEnforced,
} from "../lib/retention";

// Report retention (spec 2.8): a report is kept 12 months after its decision, then purged: the
// reporter is anonymised (reporterId and the notice's name and email go), and the reporter's
// details, the evidence snapshot's message bodies and its reported comment or review text are
// cleared. The row stays (target, reason, decision and statement of reasons) as the record of the
// decision; nothing in it names the reporter or quotes the reported content any more. The removal
// evidence copy has its own, shorter purge (reports/attachmentEvidence, 6 months).
//
// Scheduled per report at its decision (admin/decideReport) with scheduler.runAt, like the
// evidence purge: durable across deploys, exact to the report. A daily backstop
// (sweepReportRetention, crons.ts) re-arms every purge that is due but whose job was lost, for
// reports and evidence copies alike, and counts the reports left open too long.
// [LAWYER] There is no law-enforcement escalation flag on reports yet; when one is added, an
// escalated report must be exempt here and in the backstop ("longer only when escalated", spec
// 2.8).

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
      // Rebuilt from the message metadata only: the evidence `text` is dropped.
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

/** An open report older than this is overdue: the backstop logs it at error level (an alert). */
export const OPEN_REPORT_ALERT_AFTER_MS = 30 * DAY_MS;

// The overdue count reads at most this many rows (the event says when it hit the cap).
const OPEN_OVERDUE_COUNT_CAP = 500;

// Twelve calendar months are never shorter than 365 days, so every report due for its purge was
// decided at least this long ago; reportRetainUntil decides per row.
const REPORT_RETENTION_MIN_MS = 365 * DAY_MS;

const sweepPhaseValidator = v.union(
  v.literal("reports"),
  v.literal("evidence"),
);

/**
 * The daily retention backstop (crons.ts), one page per run, re-scheduling itself: first the
 * decided reports past their 12 months that were never purged (by_retention_due), then the
 * evidence copies past their 6 months (by_evidence_retain). Each due one gets its purge
 * (purgeReport / attachmentEvidence.purgeEvidence) scheduled, only when RETENTION_ENFORCE names
 * "reports" (lib/retention); otherwise it is counted and nothing changes. Open reports are never
 * purged: the first page counts those open longer than OPEN_REPORT_ALERT_AFTER_MS and logs them
 * at error level, so a monitor can alert on a report nobody decided.
 */
export const sweepReportRetention = internalMutation({
  args: {
    phase: v.optional(sweepPhaseValidator),
    cursor: v.optional(v.union(v.string(), v.null())),
    now: v.optional(v.number()),
  },
  handler: async (ctx, args) => {
    const phase = args.phase ?? "reports";
    const now = args.now ?? Date.now();
    const enforce = retentionEnforced("reports");
    const paginationOpts = {
      numItems: RETENTION_SWEEP_PAGE,
      cursor: args.cursor ?? null,
    };
    let due = 0;
    let acted = 0;
    let isDone: boolean;
    let continueCursor: string;
    if (phase === "reports") {
      const page = await ctx.db
        .query("reports")
        .withIndex("by_retention_due", (q) =>
          q
            .eq("retentionPurgedAt", undefined)
            .gt("decidedAt", 0)
            .lte("decidedAt", now - REPORT_RETENTION_MIN_MS),
        )
        .paginate(paginationOpts);
      for (const report of page.page) {
        if (
          report.decidedAt === undefined ||
          reportRetainUntil(report.decidedAt) > now
        ) {
          continue;
        }
        due++;
        if (!enforce) continue;
        await ctx.scheduler.runAfter(
          0,
          internal.reports.retention.purgeReport,
          { reportId: report._id },
        );
        acted++;
      }
      ({ isDone, continueCursor } = page);
    } else {
      const page = await ctx.db
        .query("reports")
        .withIndex("by_evidence_retain", (q) =>
          q.gt("evidenceRetainUntil", 0).lte("evidenceRetainUntil", now),
        )
        .paginate(paginationOpts);
      // One purge per evidence copy, and only once every report sharing it is past its date
      // (purgeEvidence would otherwise just re-arm itself).
      const files = new Set<Id<"_storage">>();
      for (const report of page.page) {
        if (report.evidenceFileId) files.add(report.evidenceFileId);
      }
      for (const evidenceFileId of files) {
        const sharing = await ctx.db
          .query("reports")
          .withIndex("by_evidence_file", (q) =>
            q.eq("evidenceFileId", evidenceFileId),
          )
          .collect();
        if (sharing.some((r) => (r.evidenceRetainUntil ?? 0) > now)) continue;
        due++;
        if (!enforce) continue;
        await ctx.scheduler.runAfter(
          0,
          internal.reports.attachmentEvidence.purgeEvidence,
          { evidenceFileId },
        );
        acted++;
      }
      ({ isDone, continueCursor } = page);
    }

    // Once per run, on its first page.
    let openOverdue: number | undefined;
    if (phase === "reports" && args.cursor == null) {
      openOverdue = (
        await ctx.db
          .query("reports")
          .withIndex("by_status_created", (q) =>
            q
              .eq("status", "open")
              .lt("createdAt", now - OPEN_REPORT_ALERT_AFTER_MS),
          )
          .take(OPEN_OVERDUE_COUNT_CAP)
      ).length;
    }

    if (!isDone) {
      await ctx.scheduler.runAfter(
        0,
        internal.reports.retention.sweepReportRetention,
        { phase, cursor: continueCursor, now },
      );
    } else if (phase === "reports") {
      await ctx.scheduler.runAfter(
        0,
        internal.reports.retention.sweepReportRetention,
        { phase: "evidence", cursor: null, now },
      );
    }
    logRetentionSweep({
      sweep: "reports",
      phase,
      due,
      acted,
      dryRun: !enforce,
      isDone: isDone && phase === "evidence",
      ...(openOverdue !== undefined && {
        open_overdue: openOverdue,
        open_overdue_capped: openOverdue >= OPEN_OVERDUE_COUNT_CAP,
        outcome: openOverdue > 0 ? ("error" as const) : ("success" as const),
      }),
    });
  },
});
