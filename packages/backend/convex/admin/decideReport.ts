import { toMemberId } from "@jigswap/domain";
import { ConvexError, v } from "convex/values";
import type { Doc, Id } from "../_generated/dataModel";
import { mutation, type MutationCtx } from "../_generated/server";
import { isAdmin } from "../identity/isAdmin";
import { requireMember } from "../identity/requireMember";
import { makeNotify } from "../notifications/adapters/makeNotify";
import { deleteCopyPhoto } from "./deleteCopyPhoto";
import { adminLabelOf } from "./reportViews";
import { stampModerationAction } from "./stampModerationAction";

/** Max length of the statement of reasons (DSA Art. 17). */
export const MAX_STATEMENT_OF_REASONS = 2000;

/** The voluntary review offer in every Art. 17 statement (Art. 20 is exempt at our size). */
export const REDRESS = "Reply via the contact page to request a review";

type Decision = NonNullable<Doc<"reports">["decision"]>;

const STAMP_KIND = {
  dismissed: "report_dismissed",
  content_removed: "report_content_removed",
  warned: "report_warned",
} as const satisfies Record<Decision, string>;

// Decide an open report (spec 2.5). "content_removed" tombstones a reported message or removes a
// reported photo (the confirmPhotoRemoval path); it does not apply to user, copy or exchange
// targets. "warned" and "dismissed" change no content. Every other OPEN report on the same target
// is decided with it (same decision and statement). The decision is audit-stamped; each reporter
// gets report_decided (Art. 16(5)) and the reported member gets the Art. 17 statement of reasons
// (content_removed / member_warned). The moderator is never named to either.
export const decideReport = mutation({
  args: {
    reportId: v.id("reports"),
    decision: v.union(
      v.literal("dismissed"),
      v.literal("content_removed"),
      v.literal("warned"),
    ),
    statementOfReasons: v.string(),
  },
  handler: async (ctx, args) => {
    const adminId = (await requireMember(ctx)) as unknown as Id<"users">;
    if (!(await isAdmin(ctx))) throw new ConvexError("Forbidden");

    const report = await ctx.db.get(args.reportId);
    if (!report) {
      throw new ConvexError({ code: "NotFound", message: "Not found" });
    }
    if (report.status !== "open") {
      throw new ConvexError({
        code: "ReportAlreadyDecided",
        message: "This report has already been decided",
      });
    }
    const statementOfReasons = args.statementOfReasons.trim();
    if (
      statementOfReasons.length === 0 ||
      statementOfReasons.length > MAX_STATEMENT_OF_REASONS
    ) {
      throw new ConvexError({
        code: "InvalidStatementOfReasons",
        message: `A statement of reasons of 1 to ${MAX_STATEMENT_OF_REASONS} characters is required`,
      });
    }
    const { decision } = args;
    if (decision === "content_removed") await removeContent(ctx, report);

    const now = Date.now();
    const sameTarget = await ctx.db
      .query("reports")
      .withIndex("by_target", (q) =>
        q.eq("targetKind", report.targetKind).eq("targetId", report.targetId),
      )
      .filter((q) => q.eq(q.field("status"), "open"))
      .collect();
    for (const row of sameTarget) {
      await ctx.db.patch(row._id, {
        status: decision === "dismissed" ? "dismissed" : "actioned",
        decision,
        statementOfReasons,
        decidedBy: adminId,
        decidedAt: now,
      });
    }

    await stampModerationAction(ctx, {
      actorId: adminId,
      kind: STAMP_KIND[decision],
      targetLabel:
        (await adminLabelOf(ctx, report.reportedUserId)) ?? report.targetId,
      targetId: report._id,
    });

    // No actorId and no subject on any of these: the moderator is never exposed, and the
    // outcome lives entirely in params (see notifications/copy.ts for the contract).
    const notify = makeNotify(ctx);
    for (const row of sameTarget) {
      await notify({
        memberId: toMemberId(row.reporterId),
        type: "report_decided",
        relatedId: row._id,
        params: { decision },
      });
    }
    if (decision !== "dismissed") {
      await notify({
        memberId: toMemberId(report.reportedUserId),
        type:
          decision === "content_removed" ? "content_removed" : "member_warned",
        relatedId: report._id,
        params: {
          ...(decision === "content_removed"
            ? { restricted: report.targetKind }
            : {}),
          ground: report.reason,
          reason: statementOfReasons,
          automated: "false",
          redress: REDRESS,
        },
      });
    }
  },
});

// Remove the reported content: tombstone a message, delete a photo. A target that is already
// gone (removed, or its author deleted it) needs nothing more. Other kinds have no content an
// admin can remove here.
const removeContent = async (ctx: MutationCtx, report: Doc<"reports">) => {
  switch (report.targetKind) {
    case "message": {
      const message = await ctx.db
        .query("threadMessages")
        .withIndex("by_message_id", (q) => q.eq("messageId", report.targetId))
        .first();
      if (message && message.removedAt === undefined) {
        await ctx.db.patch(message._id, {
          removedAt: Date.now(),
          removedReason: report.reason,
        });
      }
      return;
    }
    case "photo": {
      const imageId = ctx.db.normalizeId("ownedPuzzleImages", report.targetId);
      const image = imageId ? await ctx.db.get(imageId) : null;
      if (image) {
        await deleteCopyPhoto(
          ctx,
          image,
          await ctx.db.get(image.ownedPuzzleId),
        );
      }
      return;
    }
    default:
      throw new ConvexError({
        code: "InvalidDecision",
        message: `Content can't be removed for a ${report.targetKind} report`,
      });
  }
};
