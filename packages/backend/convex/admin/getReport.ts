import { ConvexError, v } from "convex/values";
import { query } from "../_generated/server";
import { isAdmin } from "../identity/isAdmin";
import { requireMember } from "../identity/requireMember";
import { adminLabelOf, reportsAgainst, targetSummaryOf } from "./reportViews";

/** How many of the reported member's other reports (earlier or later) the detail lists. */
export const OTHER_REPORTS_LIMIT = 50;

// One report for the admin decision screen: the full evidence snapshot, the Art. 16(2) notice
// when there is one, a storage URL for a photo or message-photo target that still exists, and the reported
// member's other reports (count plus status/decision). Admin-only, gated like listRejectedPhotos.
export const getReport = query({
  args: { reportId: v.id("reports") },
  handler: async (ctx, { reportId }) => {
    await requireMember(ctx);
    if (!(await isAdmin(ctx))) throw new ConvexError("Forbidden");

    const report = await ctx.db.get(reportId);
    if (!report) {
      throw new ConvexError({ code: "NotFound", message: "Not found" });
    }

    let photoUrl: string | null = null;
    if (report.targetKind === "photo") {
      const imageId = ctx.db.normalizeId("ownedPuzzleImages", report.targetId);
      const image = imageId ? await ctx.db.get(imageId) : null;
      photoUrl = image ? await ctx.storage.getUrl(image.fileId) : null;
    }
    // The reported message photo (an attachment report, or a report on its image message), while
    // its blob exists (an open report holds it). Never a quarantined one, and never before the
    // CSAM hash check passed.
    const attachmentId =
      report.targetKind === "attachment"
        ? ctx.db.normalizeId("messageAttachments", report.targetId)
        : report.targetKind === "message"
          ? ((
              await ctx.db
                .query("threadMessages")
                .withIndex("by_message_id", (q) =>
                  q.eq("messageId", report.targetId),
                )
                .first()
            )?.attachmentId ?? null)
          : null;
    const attachment = attachmentId ? await ctx.db.get(attachmentId) : null;
    if (attachment?.kind === "image") {
      photoUrl =
        attachment.moderationStatus !== "quarantined" &&
        attachment.hashCheckedAt !== undefined
          ? await ctx.storage.getUrl(attachment.fileId)
          : null;
    } else if (attachment?.mapFileId) {
      // A shared location: its rendered map preview (no third-party content, never screened).
      photoUrl = await ctx.storage.getUrl(attachment.mapFileId);
    }
    // A removed message photo: its report-only evidence copy (the served blob is gone).
    if (report.evidenceFileId) {
      photoUrl = await ctx.storage.getUrl(report.evidenceFileId);
    }

    // The notice stores the notifier email only when it differs from the account's.
    const notifierEmail =
      report.illegalNotice?.notifierEmail ??
      (report.illegalNotice
        ? (await ctx.db.get(report.reporterId))?.email
        : undefined);

    const others = (await reportsAgainst(ctx, report.reportedUserId)).filter(
      (row) => row._id !== report._id,
    );

    return {
      reportId: report._id,
      targetKind: report.targetKind,
      targetId: report.targetId,
      reason: report.reason,
      ...(report.details !== undefined ? { details: report.details } : {}),
      ...(report.illegalNotice !== undefined
        ? {
            illegalNotice: {
              ...report.illegalNotice,
              ...(notifierEmail !== undefined ? { notifierEmail } : {}),
            },
          }
        : {}),
      evidence: report.evidence,
      status: report.status,
      ...(report.decision !== undefined ? { decision: report.decision } : {}),
      ...(report.statementOfReasons !== undefined
        ? { statementOfReasons: report.statementOfReasons }
        : {}),
      ...(report.decidedAt !== undefined
        ? { decidedAt: report.decidedAt }
        : {}),
      decidedByLabel: report.decidedBy
        ? await adminLabelOf(ctx, report.decidedBy)
        : null,
      createdAt: report.createdAt,
      reporterId: report.reporterId,
      reporterLabel: await adminLabelOf(ctx, report.reporterId),
      reportedUserId: report.reportedUserId,
      reportedLabel: await adminLabelOf(ctx, report.reportedUserId),
      targetSummary: await targetSummaryOf(ctx, report),
      photoUrl,
      otherReportCount: others.length,
      otherReports: others.slice(0, OTHER_REPORTS_LIMIT).map((row) => ({
        reportId: row._id,
        targetKind: row.targetKind,
        reason: row.reason,
        status: row.status,
        ...(row.decision !== undefined ? { decision: row.decision } : {}),
        createdAt: row.createdAt,
      })),
    };
  },
});
