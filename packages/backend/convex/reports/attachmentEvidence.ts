import { v } from "convex/values";
import { internal } from "../_generated/api";
import type { Doc, Id } from "../_generated/dataModel";
import {
  internalAction,
  internalMutation,
  internalQuery,
  type MutationCtx,
} from "../_generated/server";
import { deleteAttachmentBlobs } from "../conversation/messageAttachments";
import { logEvent } from "../lib/logEvent";

// Evidence for a message photo a moderator removed (admin/decideReport, content_removed). A
// mutation cannot read blob bytes, so the decision records `evidencePendingSince` and schedules
// this action, which copies the photo into a NEW blob (never served: no URL for it was ever
// issued) referenced only from reports. Every report on the photo or its image message gets the
// copy. Only THEN is the served blob deleted (which kills every URL already handed out) and the
// evidence hold released. The copy is kept until decision + 6 months (spec 2.8).
//
// Failure: a throwing attempt is retried with EVIDENCE_RETRY_DELAYS_MS. A missing source blob,
// or a copy still failing after the last attempt, is recorded as `evidenceMissing` and the served
// blob is deleted anyway: killing the photo's public URL wins over keeping evidence.

/** How long removal evidence is kept after the decision (spec 2.8): six calendar months. */
export const evidenceRetainUntil = (decidedAt: number): number => {
  const until = new Date(decidedAt);
  until.setUTCMonth(until.getUTCMonth() + 6);
  return until.getTime();
};

/** Backoff after failed attempt n (1-based): 1 min, 5 min, 30 min, 2 h, then 6 h. */
export const EVIDENCE_RETRY_DELAYS_MS: readonly number[] = [
  60_000,
  5 * 60_000,
  30 * 60_000,
  2 * 60 * 60_000,
  6 * 60 * 60_000,
  6 * 60 * 60_000,
  6 * 60 * 60_000,
];

/** The last attempt (about 21 h after the decision); after it the served blob goes regardless. */
export const EVIDENCE_MAX_ATTEMPTS = EVIDENCE_RETRY_DELAYS_MS.length + 1;

export const loadEvidenceSource = internalQuery({
  args: { attachmentId: v.id("messageAttachments") },
  handler: async (ctx, { attachmentId }) => {
    const row = await ctx.db.get(attachmentId);
    return row ? { fileId: row.fileId } : null;
  },
});

export const preserveEvidence = internalAction({
  args: {
    reportId: v.id("reports"),
    attachmentId: v.id("messageAttachments"),
    attempt: v.optional(v.number()),
  },
  handler: async (ctx, { reportId, attachmentId, attempt }): Promise<void> => {
    const n = attempt ?? 1;
    try {
      const source = await ctx.runQuery(
        internal.reports.attachmentEvidence.loadEvidenceSource,
        { attachmentId },
      );
      const blob = source ? await ctx.storage.get(source.fileId) : null;
      if (!blob) {
        logEvent({
          event: "reports.preserveEvidence",
          outcome: "error",
          report_id: reportId,
          attachment_id: attachmentId,
          attempt: n,
          result: "source_missing",
        });
        await ctx.runMutation(
          internal.reports.attachmentEvidence.recordEvidence,
          { reportId, attachmentId },
        );
        return;
      }
      const evidenceFileId = await ctx.storage.store(
        new Blob([await blob.arrayBuffer()], {
          type: "application/octet-stream",
        }),
      );
      try {
        await ctx.runMutation(
          internal.reports.attachmentEvidence.recordEvidence,
          { reportId, attachmentId, evidenceFileId },
        );
      } catch (error) {
        await ctx.storage.delete(evidenceFileId).catch(() => {});
        throw error;
      }
    } catch (error) {
      const delayMs = EVIDENCE_RETRY_DELAYS_MS[n - 1];
      logEvent({
        event: "reports.preserveEvidence",
        outcome: "error",
        report_id: reportId,
        attachment_id: attachmentId,
        attempt: n,
        error: error instanceof Error ? error.message : String(error),
        ...(delayMs !== undefined
          ? { retry_in_ms: delayMs }
          : { result: "gave_up" }),
      });
      if (delayMs !== undefined) {
        await ctx.scheduler.runAfter(
          delayMs,
          internal.reports.attachmentEvidence.preserveEvidence,
          { reportId, attachmentId, attempt: n + 1 },
        );
        return;
      }
      await ctx.runMutation(
        internal.reports.attachmentEvidence.recordEvidence,
        { reportId, attachmentId },
      );
    }
  },
});

// Every report on the photo or on its image message, whatever its status.
const reportsOnPhoto = async (
  ctx: MutationCtx,
  attachmentId: Id<"messageAttachments">,
  messageId: string | undefined,
): Promise<Doc<"reports">[]> => {
  const targets: [Doc<"reports">["targetKind"], string][] = [
    ["attachment", attachmentId as string],
    ...(messageId !== undefined
      ? [["message", messageId] as [Doc<"reports">["targetKind"], string]]
      : []),
  ];
  const reports: Doc<"reports">[] = [];
  for (const [targetKind, targetId] of targets) {
    reports.push(
      ...(await ctx.db
        .query("reports")
        .withIndex("by_target", (q) =>
          q.eq("targetKind", targetKind).eq("targetId", targetId),
        )
        .collect()),
    );
  }
  return reports;
};

// Record the outcome on every report on the photo: the copy (with its retention date), or
// `evidenceMissing` when there is none. Then release the hold and delete the served blobs.
export const recordEvidence = internalMutation({
  args: {
    reportId: v.id("reports"),
    attachmentId: v.id("messageAttachments"),
    evidenceFileId: v.optional(v.id("_storage")),
  },
  handler: async (ctx, { reportId, attachmentId, evidenceFileId }) => {
    const decided = await ctx.db.get(reportId);
    const row = await ctx.db.get(attachmentId);
    const retainUntil = evidenceRetainUntil(decided?.decidedAt ?? Date.now());
    const reports = decided
      ? [
          decided,
          ...(await reportsOnPhoto(ctx, attachmentId, row?.messageId)).filter(
            (report) => report._id !== decided._id,
          ),
        ]
      : [];
    for (const report of reports) {
      if (report.evidenceFileId !== undefined) continue;
      await ctx.db.patch(report._id, {
        evidencePendingSince: undefined,
        ...(evidenceFileId
          ? { evidenceFileId, evidenceRetainUntil: retainUntil }
          : { evidenceMissing: true }),
      });
    }
    if (!row) return;
    // Every report on the photo now carries the copy (or knows it is missing), so the row's hold
    // protects nothing any more, even for a report still open: clear it and delete the served
    // blobs, which kills every URL already handed out.
    await ctx.db.patch(attachmentId, {
      evidenceHold: undefined,
      updatedAt: Date.now(),
    });
    await deleteAttachmentBlobs(ctx, { ...row, evidenceHold: undefined });
  },
});
