import { ConvexError } from "convex/values";
import { query } from "../_generated/server";
import { isAdmin } from "../identity/isAdmin";
import { requireMember } from "../identity/requireMember";

// Each count stops here: the console shows "50+" beyond it.
export const PENDING_COUNT_CAP = 50;

type QueueCount = { count: number; capped: boolean };

// At most CAP + 1 rows were read: `capped` says there are more than the CAP shown.
const bounded = (rows: readonly unknown[]): QueueCount => ({
  count: Math.min(rows.length, PENDING_COUNT_CAP),
  capped: rows.length > PENDING_COUNT_CAP,
});

// How much work waits in each admin queue, for the moderation tab pills, the admin sidebar badges
// and the /admin hub tiles. Every queue is one indexed read of at most CAP + 1 rows, so the query
// stays cheap however long a queue grows, and each counts exactly what its admin list shows:
// - submissions: pending catalog definitions (catalog.pending);
// - flagged: auto-rejected copy photos (admin.listRejectedPhotos);
// - appeals: message photos whose sender asked for a review not yet decided
//   (admin.listImageReviewRequests; a quarantined photo never reaches an admin);
// - reports: open reports (admin.listReports, status open);
// - hashMatches: open CSAM hash-match escalations (admin.listCsamEscalations);
// - contact: new contact-form messages (adminTriage.contactMessages);
// - proposals: pending community change proposals (admin.listPendingChangeProposals).
// Unchecked photos are not counted here: that queue's own per-source caps already bound it, and
// the console derives its count from the list. Admin-only.
export const getPendingCounts = query({
  args: {},
  handler: async (ctx) => {
    await requireMember(ctx);
    if (!(await isAdmin(ctx))) throw new ConvexError("Forbidden");

    const take = PENDING_COUNT_CAP + 1;
    const [
      submissions,
      flagged,
      appeals,
      reports,
      hashMatches,
      contact,
      proposals,
    ] = await Promise.all([
      ctx.db
        .query("puzzles")
        .withIndex("by_status", (q) => q.eq("status", "pending"))
        .take(take),
      ctx.db
        .query("ownedPuzzleImages")
        .withIndex("by_moderation_status", (q) =>
          q.eq("moderationStatus", "rejected"),
        )
        .take(take),
      ctx.db
        .query("messageAttachments")
        .withIndex("by_review_awaiting", (q) =>
          q
            .eq("moderationStatus", "rejected")
            .eq("reviewDecidedAt", undefined)
            .gt("reviewRequestedAt", 0),
        )
        .take(take),
      ctx.db
        .query("reports")
        .withIndex("by_status_created", (q) => q.eq("status", "open"))
        .take(take),
      ctx.db
        .query("csamEscalations")
        .withIndex("by_status", (q) => q.eq("status", "open"))
        .take(take),
      ctx.db
        .query("contactMessages")
        .withIndex("by_status", (q) => q.eq("status", "new"))
        .take(take),
      ctx.db
        .query("puzzleChangeProposals")
        .withIndex("by_status", (q) => q.eq("status", "pending"))
        .take(take),
    ]);

    return {
      submissions: bounded(submissions),
      flagged: bounded(flagged),
      appeals: bounded(appeals),
      reports: bounded(reports),
      hashMatches: bounded(hashMatches),
      contact: bounded(contact),
      proposals: bounded(proposals),
    };
  },
});
