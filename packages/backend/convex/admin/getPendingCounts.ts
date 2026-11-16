import { query } from "../_generated/server";
import { requireAdmin } from "../identity/isAdmin";
import { INVALID_IMAGE_LABEL } from "../lib/imageModeration/guards";

// Each count stops here: the console shows "50+" beyond it.
export const PENDING_COUNT_CAP = 50;

type QueueCount = { count: number; capped: boolean };

// At most CAP + 1 rows were read: `capped` says there are more than the CAP shown.
const bounded = (rows: readonly unknown[]): QueueCount => ({
  count: Math.min(rows.length, PENDING_COUNT_CAP),
  capped: rows.length > PENDING_COUNT_CAP,
});

// How much work waits in each admin queue, for the moderation tab pills, the admin sidebar badges
// and the /admin hub tiles. Every queue is one indexed read that stops after CAP + 1 counted rows,
// and each counts exactly what its admin list shows:
// - submissions: pending catalog definitions (catalog.pending);
// - flagged: auto-rejected copy photos, refused uploads left out (admin.listRejectedPhotos);
// - appeals: message photos whose sender asked for a review not yet decided
//   (admin.listImageReviewRequests; a quarantined photo never reaches an admin);
// - reports: open reports (admin.listReports, status open);
// - hashMatches: open CSAM hash-match escalations (admin.listCsamEscalations);
// - contact: new contact-form messages (adminTriage.contactMessages);
// - proposals: pending community change proposals (admin.listPendingChangeProposals).
// Unchecked photos are not counted here: that queue's own per-source caps already bound it, and
// the console derives its count from the list. Admin-only.
// shortcut: flagged filters refused uploads (invalid_image) after its index, so it also reads past
// every one of them, and nothing deletes them unless RETENTION_ENFORCE names copyPhotos ("all"
// leaves it out); give them their own index if they pile up.
export const getPendingCounts = query({
  args: {},
  handler: async (ctx) => {
    await requireAdmin(ctx);

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
        .filter((q) => q.neq(q.field("moderationLabel"), INVALID_IMAGE_LABEL))
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
