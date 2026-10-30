import { ConvexError, v } from "convex/values";
import type { Id } from "../_generated/dataModel";
import { query, type QueryCtx } from "../_generated/server";
import { isAdmin } from "../identity/isAdmin";
import { requireMember } from "../identity/requireMember";
import { isHashCleared } from "../lib/imageModeration/hashCheckFields";
import { isPreservedBlob } from "../lib/imageModeration/quarantine";
import { adminLabelOf, reportsAgainst, targetSummaryOf } from "./reportViews";

/** How many of the reported member's other reports (earlier or later) the detail lists. */
export const OTHER_REPORTS_LIMIT = 50;

// A storage URL for the report screen, never for a blob a CSAM escalation preserves: those bytes
// are shown to nobody, admins included (lib/imageModeration/quarantine).
const urlUnlessPreserved = async (
  ctx: QueryCtx,
  fileId: Id<"_storage">,
): Promise<string | null> =>
  (await isPreservedBlob(ctx, fileId)) ? null : ctx.storage.getUrl(fileId);

// One report for the admin decision screen: the full evidence snapshot, the Art. 16(2) notice
// when there is one, a storage URL for a photo or message-photo target that still exists, and the reported
// member's other reports (count plus status/decision). Admin-only, gated like listRejectedPhotos.
// No URL is ever issued for quarantined (CSAM-matched) bytes or for bytes whose hash check has not
// passed: not for the photo, and not for a removed message photo's evidence copy (SEC-04).
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
      // Only as members saw it: approved (absent = legacy) and past the CSAM hash check. Never a
      // quarantined one, whose fileId is the escalation's preserved blob.
      photoUrl =
        image &&
        (image.moderationStatus ?? "approved") === "approved" &&
        isHashCleared(image)
          ? await urlUnlessPreserved(ctx, image.fileId)
          : null;
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
    // The gate covers the photo's evidence copy too: it holds the same bytes.
    const photoWithheld =
      attachment?.kind === "image" &&
      (attachment.moderationStatus === "quarantined" ||
        attachment.hashCheckedAt === undefined);
    if (attachment?.kind === "image") {
      photoUrl = photoWithheld
        ? null
        : await urlUnlessPreserved(ctx, attachment.fileId);
    } else if (attachment?.mapFileId) {
      // A shared location: its rendered map preview (no third-party content, never screened).
      photoUrl = await urlUnlessPreserved(ctx, attachment.mapFileId);
    }
    // A removed message photo: its report-only evidence copy (the served blob is gone). Not while
    // the photo is withheld: a copy made before a later CSAM match, or before its hash check passed,
    // is never shown.
    if (report.evidenceFileId && !photoWithheld) {
      photoUrl = await urlUnlessPreserved(ctx, report.evidenceFileId);
    }

    // The notice stores the notifier email only when it differs from the account's.
    const notifierEmail =
      report.illegalNotice?.notifierEmail ??
      (report.illegalNotice && report.reporterId
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
