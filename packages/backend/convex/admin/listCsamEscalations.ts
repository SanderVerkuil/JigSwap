import { ConvexError } from "convex/values";
import { query } from "../_generated/server";
import { isAdmin } from "../identity/isAdmin";
import { adminMemberLabelOf } from "../identity/memberDisplayName";
import { requireMember } from "../identity/requireMember";
import { readCsamHashCheckConfig } from "../lib/imageModeration/csamHashCheck";
import { isHashCheckTimedOut } from "../lib/imageModeration/hashCheckFields";

// At most this many escalations per status are listed (newest first).
export const CSAM_ESCALATION_LIST_LIMIT = 100;

// Per table, the waiting-for-hash-check count stops here (the tab then shows "N+"), and so does
// the count of photos published without a hash check.
export const HASH_CHECK_WAITING_CAP = 200;

const IMAGE_TABLES = [
  "ownedPuzzleImages",
  "completionImages",
  "messageAttachments",
  "boxArtUploads",
  "circleIcons",
] as const;

// Admin-only list of CSAM hash matches for the operator to report (lib/imageModeration/
// quarantine). METADATA ONLY: never an image URL, thumbnail, blurhash or storage id. The image is
// never shown to anyone, admins included. Also reports whether hash matching is configured on
// this deployment (provider + the NAMES of missing env vars, never values), and how many photos
// were published without a hash check while it was not (SEC-03).
export const listCsamEscalations = query({
  args: {},
  handler: async (ctx) => {
    await requireMember(ctx);
    if (!(await isAdmin(ctx))) throw new ConvexError("Forbidden");

    const statuses = ["open", "reported", "closed"] as const;
    const escalations = [];
    for (const status of statuses) {
      const rows = await ctx.db
        .query("csamEscalations")
        .withIndex("by_status", (q) => q.eq("status", status))
        .order("desc")
        .take(CSAM_ESCALATION_LIST_LIMIT);
      for (const row of rows) {
        const uploader = await ctx.db.get(row.uploaderId);
        escalations.push({
          id: row._id,
          table: row.table,
          uploaderId: row.uploaderId,
          // The live account when it still has a profile, else the snapshot taken at match time
          // (the account may have been deleted or tombstoned since).
          uploaderLabel:
            uploader && uploader.isActive
              ? adminMemberLabelOf(uploader)
              : (row.uploaderSnapshot?.name ??
                row.uploaderSnapshot?.email ??
                row.uploaderSnapshot?.clerkId ??
                null),
          uploaderSnapshot: row.uploaderSnapshot ?? null,
          md5: row.md5,
          sha1: row.sha1,
          provider: row.provider,
          matchedAt: row.matchedAt,
          status: row.status,
          reportedAt: row.reportedAt ?? null,
          notes: await Promise.all(
            (row.notes ?? []).map(async (n) => {
              const actor = await ctx.db.get(n.actorId);
              return {
                at: n.at,
                text: n.text,
                actorLabel: actor ? adminMemberLabelOf(actor) : null,
              };
            }),
          ),
        });
      }
    }
    // Photos held unpublished because the hash check was unavailable (stored hashes awaiting a
    // re-check), across the image tables: a count (capped) and the oldest wait. Photos whose
    // check timed out are counted apart: they wait on an admin (Unchecked photos), not a re-check.
    // The index also holds rows neither count covers (a photo the pipeline has not reached yet, a
    // timed-out one an admin rejected, refused or quarantined rows from before they left the
    // index): those are filtered out BEFORE the cap, so no number of them can hide a waiting
    // photo (SEC-55). They are few, so the scan stays small.
    let waitingPhotos = 0;
    let timedOutPhotos = 0;
    let oldestWaitingSince: number | null = null;
    for (const table of IMAGE_TABLES) {
      const rows = await ctx.db
        .query(table)
        .withIndex("by_hash_check_pending", (q) =>
          q.gt("hashCheckPendingSince", 0),
        )
        .filter((q) =>
          q.and(
            q.neq(q.field("pendingHashes"), undefined),
            q.neq(q.field("moderationStatus"), "quarantined"),
            // A timed-out photo counts only while an admin has not rejected it.
            q.or(
              q.eq(q.field("hashCheckTimedOutAt"), undefined),
              q.neq(q.field("hashCheckedAt"), undefined),
              q.and(
                q.neq(q.field("moderationStatus"), "rejected"),
                q.neq(q.field("moderationStatus"), "removed"),
              ),
            ),
          ),
        )
        .take(HASH_CHECK_WAITING_CAP);
      for (const row of rows) {
        // (A shared location is never hash-checked; the index holds only photos.)
        if ("kind" in row && row.kind === "location") continue;
        if (isHashCheckTimedOut(row)) {
          timedOutPhotos += 1;
          continue;
        }
        waitingPhotos += 1;
        const since = row.hashCheckPendingSince ?? null;
        if (
          since !== null &&
          (oldestWaitingSince === null || since < oldestWaitingSince)
        ) {
          oldestWaitingSince = since;
        }
      }
    }
    // Photos published WITHOUT a hash check because none was configured (hashCheckSkippedAt),
    // still awaiting one (the one-shot recheckWaivedHashes checks them once it is): a count, capped
    // per table (`uncheckedCapped` says whether any table hit the cap), and the oldest. Counting
    // started when the marker shipped: photos published before carry nothing and are not counted.
    // A quarantined one (a later check matched) is filtered out before the cap.
    let uncheckedPhotos = 0;
    let uncheckedCapped = false;
    let uncheckedSince: number | null = null;
    for (const table of IMAGE_TABLES) {
      const rows = await ctx.db
        .query(table)
        .withIndex("by_hash_check_skipped", (q) =>
          q.gt("hashCheckSkippedAt", 0),
        )
        .filter((q) => q.neq(q.field("moderationStatus"), "quarantined"))
        .take(HASH_CHECK_WAITING_CAP);
      uncheckedPhotos += rows.length;
      if (rows.length >= HASH_CHECK_WAITING_CAP) uncheckedCapped = true;
      // The index is in skip order: the first row is the table's oldest.
      const first = rows[0];
      const since =
        first && "hashCheckSkippedAt" in first
          ? (first.hashCheckSkippedAt ?? null)
          : null;
      if (
        since !== null &&
        (uncheckedSince === null || since < uncheckedSince)
      ) {
        uncheckedSince = since;
      }
    }
    return {
      hashCheck: {
        ...readCsamHashCheckConfig(process.env),
        waitingPhotos,
        oldestWaitingSince,
        timedOutPhotos,
        waitingCap: HASH_CHECK_WAITING_CAP,
        uncheckedPhotos,
        uncheckedSince,
        uncheckedCapped,
      },
      escalations,
    };
  },
});
