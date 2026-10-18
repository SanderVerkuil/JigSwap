import type { Doc, Id } from "../_generated/dataModel";
import type { QueryCtx } from "../_generated/server";
import { adminMemberLabelOf } from "../identity/memberDisplayName";
import { messagePreviewOf } from "../notifications/viewRules";

// Shared read helpers for the admin report queue (listReports, getReport) and decideReport's
// audit label. Admin-only surfaces: labels may include the email by design.

/** A member's admin label, or null when the account is gone. */
export const adminLabelOf = async (
  ctx: QueryCtx,
  userId: Id<"users">,
): Promise<string | null> => {
  const user = await ctx.db.get(userId);
  return user ? adminMemberLabelOf(user) : null;
};

const copyTitleOf = async (
  ctx: QueryCtx,
  copyId: Id<"ownedPuzzles">,
): Promise<string | null> => {
  const copy = await ctx.db.get(copyId);
  if (!copy) return null;
  return (
    copy.snapshot?.title ?? (await ctx.db.get(copy.puzzleId))?.title ?? null
  );
};

/**
 * A one-line summary of what was reported: the message's snapshotted text, the copy's (or the
 * photo's copy's, or the exchange's requested copy's) puzzle title. Null when there is nothing
 * to show (a user target, or the target is gone).
 */
export const targetSummaryOf = async (
  ctx: QueryCtx,
  report: Doc<"reports">,
): Promise<string | null> => {
  switch (report.targetKind) {
    case "message": {
      const snapshot = report.evidence.messages?.find(
        (m) => m.messageId === report.targetId,
      );
      return snapshot ? (messagePreviewOf(snapshot.body) ?? null) : null;
    }
    case "copy": {
      const copyId = ctx.db.normalizeId("ownedPuzzles", report.targetId);
      return copyId ? copyTitleOf(ctx, copyId) : null;
    }
    case "photo": {
      const imageId = ctx.db.normalizeId("ownedPuzzleImages", report.targetId);
      const image = imageId ? await ctx.db.get(imageId) : null;
      return image ? copyTitleOf(ctx, image.ownedPuzzleId) : null;
    }
    case "exchange": {
      const exchange =
        (await ctx.db
          .query("exchanges")
          .withIndex("by_aggregate_id", (q) =>
            q.eq("aggregateId", report.targetId),
          )
          .first()) ??
        (await (async () => {
          const id = ctx.db.normalizeId("exchanges", report.targetId);
          return id ? ctx.db.get(id) : null;
        })());
      return exchange ? copyTitleOf(ctx, exchange.requestedPuzzleId) : null;
    }
    case "user":
      return null;
  }
};

/** Every report against a member, newest first. */
export const reportsAgainst = (ctx: QueryCtx, userId: Id<"users">) =>
  ctx.db
    .query("reports")
    .withIndex("by_reported_user", (q) => q.eq("reportedUserId", userId))
    .order("desc")
    .collect();
