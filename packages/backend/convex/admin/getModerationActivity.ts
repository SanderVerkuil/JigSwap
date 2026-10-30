import { paginationOptsValidator, type PaginationResult } from "convex/server";
import { ConvexError, v } from "convex/values";
import type { Doc, Id } from "../_generated/dataModel";
import { query, type QueryCtx } from "../_generated/server";
import { isAdmin } from "../identity/isAdmin";
import { requireMember } from "../identity/requireMember";
import { clampPaginationOpts } from "../lib/pageSize";
import schema from "../schema";
import { toAuditEntry } from "./auditEntry";

// Admin-only, but the page size is still the client's request: each row joins the actor, a
// targeted member and the linked page, so a page holds at most this many (the console asks for 25).
const MAX_PAGE_SIZE = 100;

type ModerationKind = Doc<"moderationActions">["kind"];

/** The page an audit row is about, for the console to link to. */
export type ActivityTarget =
  | { kind: "puzzle"; puzzleId: Id<"puzzles"> }
  | { kind: "member"; userId: Id<"users"> }
  | { kind: "report"; reportId: Id<"reports"> };

// What each kind's targetId names (see the stampModerationAction call sites), and so which page
// it resolves to. Exhaustive on purpose: a new kind must say what it links to (null = nothing an
// admin page shows, e.g. a photo or a hash-match escalation).
// - definition_* / proposal_*: the definition's aggregate id (a proposal stamp falls back to the
//   proposal id when the definition is unknown, which then resolves to nothing);
// - role_*: the member (targetMemberId; a legacy row not yet backfilled holds their Clerk id in
//   targetId);
// - report_*: the report's _id.
const TARGET_KIND: Record<ModerationKind, ActivityTarget["kind"] | null> = {
  definition_approved: "puzzle",
  definition_rejected: "puzzle",
  definition_edited_approved: "puzzle",
  definition_disabled: "puzzle",
  definition_reenabled: "puzzle",
  definition_edited: "puzzle",
  proposal_approved: "puzzle",
  proposal_rejected: "puzzle",
  photo_restored: null,
  photo_removal_confirmed: null,
  photo_auto_rejected: null,
  photo_manually_approved: null,
  photo_manually_rejected: null,
  photo_hash_check_waived: null,
  image_quarantined: null,
  csam_escalation_updated: null,
  role_granted: "member",
  role_revoked: "member",
  report_dismissed: "report",
  report_content_removed: "report",
  report_warned: "report",
  message_image_auto_rejected: null,
  message_image_restored: null,
  photo_recheck_requested: null,
  category_created: null,
  category_updated: null,
  category_deactivated: null,
  category_reactivated: null,
  categories_reordered: null,
  contact_message_handled: null,
};

// The row's target as a link, or null when it no longer exists (a deleted puzzle, member or
// report) or is nothing the console has a page for.
const targetOf = async (
  ctx: QueryCtx,
  row: Doc<"moderationActions">,
): Promise<ActivityTarget | null> => {
  switch (TARGET_KIND[row.kind]) {
    case "puzzle": {
      const puzzle = await ctx.db
        .query("puzzles")
        .withIndex("by_aggregate_id", (q) => q.eq("aggregateId", row.targetId))
        .first();
      return puzzle ? { kind: "puzzle", puzzleId: puzzle._id } : null;
    }
    case "member": {
      const user =
        row.targetMemberId !== undefined
          ? await ctx.db.get(row.targetMemberId)
          : await ctx.db
              .query("users")
              .withIndex("by_clerk_id", (q) => q.eq("clerkId", row.targetId))
              .first();
      return user ? { kind: "member", userId: user._id } : null;
    }
    case "report": {
      const reportId = ctx.db.normalizeId("reports", row.targetId);
      const report = reportId ? await ctx.db.get(reportId) : null;
      return report ? { kind: "report", reportId: report._id } : null;
    }
    case null:
      return null;
  }
};

// One activity-log row: the audit entry (the actor's display name, null = automated pipeline or an
// admin since deleted, and a targeted member's label resolved now; admin/auditEntry) plus the
// row's id, the actor's id and the target resolved to a linkable page.
const toActivityRow = async (ctx: QueryCtx, row: Doc<"moderationActions">) => {
  const entry = await toAuditEntry(ctx, row);
  return {
    ...entry,
    actionId: row._id,
    actorId: entry.actorName === null ? null : (row.actorId ?? null),
    target: await targetOf(ctx, row),
  };
};
type ActivityRow = Awaited<ReturnType<typeof toActivityRow>>;

// The moderation console's activity log: every moderation decision, newest first and paginated,
// optionally narrowed to one kind (by_kind) and/or one acting admin (by_actor). Admin-only, gated
// exactly like listPendingPuzzleDefinitions.
export const getModerationActivity = query({
  args: {
    paginationOpts: paginationOptsValidator,
    kind: v.optional(schema.tables.moderationActions.validator.fields.kind),
    // A member _id from the console's URL: normalised here, never trusted as an id.
    actorId: v.optional(v.string()),
  },
  handler: async (
    ctx,
    { paginationOpts, kind, actorId },
  ): Promise<PaginationResult<ActivityRow>> => {
    await requireMember(ctx);
    if (!(await isAdmin(ctx))) throw new ConvexError("Forbidden");

    const actorFilter =
      actorId === undefined ? undefined : ctx.db.normalizeId("users", actorId);
    // An actor id that names no member matches nothing (a stale or mangled link).
    if (actorFilter === null) {
      return { page: [], isDone: true, continueCursor: "" };
    }

    const actions = ctx.db.query("moderationActions");
    const result = await (
      actorFilter !== undefined
        ? // An admin's own actions are few next to the whole log, so the kind is a filter here.
          actions
            .withIndex("by_actor", (q) => q.eq("actorId", actorFilter))
            .order("desc")
            .filter((q) =>
              kind === undefined ? true : q.eq(q.field("kind"), kind),
            )
        : kind !== undefined
          ? actions
              .withIndex("by_kind", (q) => q.eq("kind", kind))
              .order("desc")
          : actions.withIndex("by_at").order("desc")
    ).paginate(clampPaginationOpts(paginationOpts, MAX_PAGE_SIZE));

    return {
      ...result,
      page: await Promise.all(
        result.page.map((row) => toActivityRow(ctx, row)),
      ),
    };
  },
});
