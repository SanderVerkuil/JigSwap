import { ConvexError, v } from "convex/values";
import type { Doc, Id } from "../_generated/dataModel";
import { mutation, type MutationCtx } from "../_generated/server";
import { requireMember } from "../identity/requireMember";
import { enforceRateLimit } from "../lib/rateLimits";
import { canViewCopy } from "../library/canViewCopy";
import schema from "../schema";

const reportFields = schema.tables.reports.validator.fields;

/** Max length of the reporter's optional free-text details. */
export const MAX_REPORT_DETAILS = 1000;
/** How many messages before the reported one the evidence snapshot keeps. */
export const EVIDENCE_PRECEDING_MESSAGES = 10;

type Evidence = Doc<"reports">["evidence"];
type Target = {
  /** The canonical target id stored on the report (dedupe key). */
  targetId: string;
  reportedUserId: Id<"users">;
  evidence: Evidence;
};

// Every refusal (missing, not visible to the reporter, the reporter's own, a system message) is
// the same generic NotFound, so filing can't be used to probe what exists.
const notFound = () =>
  new ConvexError({ code: "NotFound", message: "Not found" });

// File a DSA notice (spec 2.5) about a member or their content. The reporter must be able to see
// the target; one OPEN report per reporter and target (a repeat returns the existing report
// unchanged). Filing never changes the target itself: only an admin decision can
// (admin/decideReport). A message report snapshots the message and its preceding context now,
// so a later edit or removal can't destroy the evidence.
export const fileReport = mutation({
  args: {
    targetKind: reportFields.targetKind,
    targetId: v.string(),
    reason: reportFields.reason,
    details: v.optional(v.string()),
    // DSA Art. 16(2): required for "illegal". Name and email default to the account's.
    illegalNotice: v.optional(
      v.object({
        notifierName: v.optional(v.string()),
        notifierEmail: v.optional(v.string()),
        goodFaith: v.boolean(),
      }),
    ),
  },
  handler: async (ctx, args): Promise<{ reportId: Id<"reports"> }> => {
    const reporterId = (await requireMember(ctx)) as unknown as Id<"users">;
    await enforceRateLimit(ctx, "reportFile", reporterId);

    const details = args.details?.trim() || undefined;
    if (details !== undefined && details.length > MAX_REPORT_DETAILS) {
      throw new ConvexError({
        code: "DetailsTooLong",
        message: `Details can be at most ${MAX_REPORT_DETAILS} characters`,
      });
    }
    const illegalNotice =
      args.reason === "illegal"
        ? await illegalNoticeOf(ctx, reporterId, args.illegalNotice)
        : undefined;

    const target = await resolveTarget(
      ctx,
      reporterId,
      args.targetKind,
      args.targetId,
    );
    if (!target || target.reportedUserId === reporterId) throw notFound();

    const existing = await ctx.db
      .query("reports")
      .withIndex("by_reporter_target", (q) =>
        q
          .eq("reporterId", reporterId)
          .eq("targetKind", args.targetKind)
          .eq("targetId", target.targetId),
      )
      .filter((q) => q.eq(q.field("status"), "open"))
      .first();
    if (existing) return { reportId: existing._id };

    const reportId = await ctx.db.insert("reports", {
      reporterId,
      targetKind: args.targetKind,
      targetId: target.targetId,
      reportedUserId: target.reportedUserId,
      reason: args.reason,
      ...(details !== undefined ? { details } : {}),
      ...(illegalNotice ? { illegalNotice } : {}),
      evidence: target.evidence,
      status: "open",
      createdAt: Date.now(),
    });
    return { reportId };
  },
});

// The Art. 16(2) notice for an "illegal" report: the good-faith statement is required; the
// notifier's name and email fall back to the account's when the client omits them.
const illegalNoticeOf = async (
  ctx: MutationCtx,
  reporterId: Id<"users">,
  notice:
    | { notifierName?: string; notifierEmail?: string; goodFaith: boolean }
    | undefined,
): Promise<NonNullable<Doc<"reports">["illegalNotice"]>> => {
  if (!notice?.goodFaith) {
    throw new ConvexError({
      code: "IllegalNoticeRequired",
      message: "Reporting illegal content needs a good-faith statement",
    });
  }
  const account = await ctx.db.get(reporterId);
  const notifierName =
    notice.notifierName?.trim() || account?.name?.trim() || undefined;
  const notifierEmail =
    notice.notifierEmail?.trim() || account?.email?.trim() || undefined;
  if (!notifierName || !notifierEmail) {
    throw new ConvexError({
      code: "IllegalNoticeIncomplete",
      message: "Reporting illegal content needs your name and email",
    });
  }
  return { notifierName, notifierEmail, goodFaith: true };
};

// Resolve the target as the reporter may see it, or null when it doesn't exist or isn't visible.
const resolveTarget = async (
  ctx: MutationCtx,
  reporterId: Id<"users">,
  kind: Doc<"reports">["targetKind"],
  targetId: string,
): Promise<Target | null> => {
  switch (kind) {
    case "message":
      return messageTarget(ctx, reporterId, targetId);
    case "user": {
      // Any existing member: still reportable after a block, so no block gate here.
      const userId = ctx.db.normalizeId("users", targetId);
      const user = userId ? await ctx.db.get(userId) : null;
      return user
        ? { targetId: user._id, reportedUserId: user._id, evidence: {} }
        : null;
    }
    case "copy": {
      const copyId = ctx.db.normalizeId("ownedPuzzles", targetId);
      const copy = copyId ? await ctx.db.get(copyId) : null;
      if (!copy || !(await canViewCopy(ctx, reporterId, copy))) return null;
      return { targetId: copy._id, reportedUserId: copy.ownerId, evidence: {} };
    }
    case "photo": {
      const imageId = ctx.db.normalizeId("ownedPuzzleImages", targetId);
      const image = imageId ? await ctx.db.get(imageId) : null;
      // Only photos others can see: approved (absent = legacy, approved), on a viewable copy.
      if (
        !image ||
        image.moderationStatus === "pending" ||
        image.moderationStatus === "rejected"
      ) {
        return null;
      }
      const copy = await ctx.db.get(image.ownedPuzzleId);
      if (!copy || !(await canViewCopy(ctx, reporterId, copy))) return null;
      return {
        targetId: image._id,
        reportedUserId: image.uploaderId,
        evidence: {},
      };
    }
    case "exchange": {
      // The exchange aggregateId the web holds, raw `_id` fallback for pre-aggregateId rows.
      const byAggregate = await ctx.db
        .query("exchanges")
        .withIndex("by_aggregate_id", (q) => q.eq("aggregateId", targetId))
        .first();
      const rawId = byAggregate
        ? null
        : ctx.db.normalizeId("exchanges", targetId);
      const exchange = byAggregate ?? (rawId ? await ctx.db.get(rawId) : null);
      if (!exchange) return null;
      const other =
        exchange.initiatorId === reporterId
          ? exchange.recipientId
          : exchange.recipientId === reporterId
            ? exchange.initiatorId
            : null;
      if (!other) return null;
      return {
        targetId: exchange.aggregateId ?? exchange._id,
        reportedUserId: other,
        evidence: {},
      };
    }
  }
};

// A message the reporter can read (a participant of its thread), authored by someone. The
// evidence is the message plus up to EVIDENCE_PRECEDING_MESSAGES before it, ascending. A message
// a moderator already removed is snapshotted as removed, with an empty body and no copy.
const messageTarget = async (
  ctx: MutationCtx,
  reporterId: Id<"users">,
  messageId: string,
): Promise<Target | null> => {
  const message = await ctx.db
    .query("threadMessages")
    .withIndex("by_message_id", (q) => q.eq("messageId", messageId))
    .first();
  if (!message?.authorId) return null; // missing, or a system message
  const thread = await ctx.db
    .query("threads")
    .withIndex("by_aggregate_id", (q) =>
      q.eq("aggregateId", message.threadAggregateId),
    )
    .unique();
  if (!thread?.participants.includes(reporterId)) return null;

  const preceding = await ctx.db
    .query("threadMessages")
    .withIndex("by_thread_sent", (q) =>
      q
        .eq("threadAggregateId", message.threadAggregateId)
        .lt("sentAt", message.sentAt),
    )
    .order("desc")
    .take(EVIDENCE_PRECEDING_MESSAGES);
  const messages = [...preceding.reverse(), message].map((row) => {
    const removed = row.removedAt !== undefined;
    return {
      messageId: row.messageId,
      ...(row.authorId !== undefined ? { authorId: row.authorId } : {}),
      kind: row.kind,
      body: removed ? "" : row.body,
      sentAt: row.sentAt,
      ...(row.copyId !== undefined && !removed ? { copyId: row.copyId } : {}),
      ...(removed ? { removed: true as const } : {}),
    };
  });
  return {
    targetId: message.messageId,
    reportedUserId: message.authorId,
    evidence: { messages },
  };
};
