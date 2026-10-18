import { v } from "convex/values";
import { internal } from "../_generated/api";
import {
  internalAction,
  internalMutation,
  internalQuery,
} from "../_generated/server";
import {
  deleteAttachmentBlobs,
  releaseEvidenceHold,
} from "../conversation/messageAttachments";

// Evidence for a message photo a moderator removed (admin/decideReport, content_removed). A
// mutation cannot read blob bytes, so the decision schedules this action, which copies the photo
// into a NEW blob (never served: no URL for it was ever issued) that only the report references.
// Then the served blob is deleted, which kills every URL already handed out, and the evidence hold
// is released. The copy is kept until decision + 6 months (spec 2.8); the retention job purges it.

/** How long removal evidence is kept after the decision (spec 2.8): six calendar months. */
export const evidenceRetainUntil = (decidedAt: number): number => {
  const until = new Date(decidedAt);
  until.setUTCMonth(until.getUTCMonth() + 6);
  return until.getTime();
};

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
  },
  handler: async (ctx, { reportId, attachmentId }): Promise<void> => {
    const source = await ctx.runQuery(
      internal.reports.attachmentEvidence.loadEvidenceSource,
      { attachmentId },
    );
    const blob = source ? await ctx.storage.get(source.fileId) : null;
    const evidenceFileId = blob
      ? await ctx.storage.store(
          new Blob([await blob.arrayBuffer()], {
            type: "application/octet-stream",
          }),
        )
      : undefined;
    await ctx.runMutation(internal.reports.attachmentEvidence.recordEvidence, {
      reportId,
      attachmentId,
      evidenceFileId,
    });
  },
});

export const recordEvidence = internalMutation({
  args: {
    reportId: v.id("reports"),
    attachmentId: v.id("messageAttachments"),
    evidenceFileId: v.optional(v.id("_storage")),
  },
  handler: async (ctx, { reportId, attachmentId, evidenceFileId }) => {
    const report = await ctx.db.get(reportId);
    if (report && evidenceFileId) {
      await ctx.db.patch(reportId, {
        evidenceFileId,
        evidenceRetainUntil: evidenceRetainUntil(
          report.decidedAt ?? Date.now(),
        ),
      });
    }
    const row = await ctx.db.get(attachmentId);
    if (!row) return;
    // The removal's own reports are decided by now, so only other open ones keep the hold; with
    // the copy made, the served blob goes either way (the content is removed).
    await releaseEvidenceHold(ctx, attachmentId);
    await deleteAttachmentBlobs(ctx, { ...row, evidenceHold: undefined });
  },
});
