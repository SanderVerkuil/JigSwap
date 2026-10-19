import { ConvexError } from "convex/values";
import { query } from "../_generated/server";
import { isAdmin } from "../identity/isAdmin";
import { adminMemberLabelOf } from "../identity/memberDisplayName";
import { requireMember } from "../identity/requireMember";
import { readCsamHashCheckConfig } from "../lib/imageModeration/csamHashCheck";

// At most this many escalations per status are listed (newest first).
export const CSAM_ESCALATION_LIST_LIMIT = 100;

// Per table, the waiting-for-hash-check count stops here (the tab then shows "N+").
export const HASH_CHECK_WAITING_CAP = 200;

// Admin-only list of CSAM hash matches for the operator to report (lib/imageModeration/
// quarantine). METADATA ONLY: never an image URL, thumbnail, blurhash or storage id. The image is
// never shown to anyone, admins included. Also reports whether hash matching is configured on
// this deployment (provider + the NAMES of missing env vars, never values).
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
    // re-check), across the image tables: a count (capped) and the oldest wait.
    let waitingPhotos = 0;
    let oldestWaitingSince: number | null = null;
    for (const table of [
      "ownedPuzzleImages",
      "completionImages",
      "messageAttachments",
      "boxArtUploads",
    ] as const) {
      const rows = await ctx.db
        .query(table)
        .withIndex("by_hash_check_pending", (q) =>
          q.gt("hashCheckPendingSince", 0),
        )
        .take(HASH_CHECK_WAITING_CAP);
      for (const row of rows) {
        // (A shared location is never hash-checked; the index holds only photos.)
        if ("kind" in row && row.kind === "location") continue;
        if (!row.pendingHashes || row.moderationStatus === "quarantined") {
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
    return {
      hashCheck: {
        ...readCsamHashCheckConfig(process.env),
        waitingPhotos,
        oldestWaitingSince,
        waitingCap: HASH_CHECK_WAITING_CAP,
      },
      escalations,
    };
  },
});
