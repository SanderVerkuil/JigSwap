import { toMemberId } from "@jigswap/domain";
import { ConvexError, v } from "convex/values";
import type { Id } from "../_generated/dataModel";
import { mutation } from "../_generated/server";
import { detachRejectedBoxArt } from "../catalog/boxArtModerationStore";
import {
  deleteAttachmentBlobs,
  deleteReveals,
  MESSAGE_PHOTO_LABEL,
} from "../conversation/messageAttachments";
import { isAdmin } from "../identity/isAdmin";
import { requireMember } from "../identity/requireMember";
import { boxArtTitle } from "../lib/imageModeration/boxArtReferences";
import {
  isHashCheckTimedOut,
  isHashCleared,
} from "../lib/imageModeration/hashCheckFields";
import { isPreservedBlob } from "../lib/imageModeration/quarantine";
import { makeNotify } from "../notifications/adapters/makeNotify";
import { CIRCLE_ICON_LABEL } from "../sharing/circleIconModerationStore";
import { settleCircleIcon } from "../sharing/circleIcons";
import { detachRejectedCompletionPhoto } from "../solving/completionModerationStore";
import { REDRESS } from "./decideReport";
import { stampModerationAction } from "./stampModerationAction";

type DecidableRow = {
  moderationStatus?: string;
  hashCheckedAt?: number;
  hashCheckPendingSince?: number;
  hashCheckTimedOutAt?: number;
};

// Whether the row waits on an admin because its hash check timed out (and nothing else decided it).
const heldByTimeout = (row: DecidableRow): boolean =>
  isHashCheckTimedOut(row) &&
  row.moderationStatus !== "rejected" &&
  row.moderationStatus !== "quarantined" &&
  row.moderationStatus !== "removed";

type Decision = "approve" | "waive_hash_check" | "reject";

// A timed-out photo is published only through the explicit waiver, and the waiver is offered for
// nothing else: "approve" never skips a hash check by accident.
const assertDecisionFits = (row: DecidableRow, decision: Decision): void => {
  const timedOut = heldByTimeout(row);
  if (decision === "approve" && timedOut) {
    throw new ConvexError(
      "Photo's hash check timed out: approve it without a hash check instead",
    );
  }
  if (decision === "waive_hash_check" && !timedOut) {
    throw new ConvexError("Photo's hash check has not timed out");
  }
};

// The guard of copy photos, completion photos and box art: the row is in the admin queue, and the
// decision fits it (assertDecisionFits).
const assertDecidable = (row: DecidableRow, decision: Decision): void => {
  if (heldByTimeout(row)) {
    assertDecisionFits(row, decision);
    return;
  }
  if (
    row.moderationStatus !== "pending" &&
    row.moderationStatus !== "unscored"
  ) {
    throw new ConvexError("Photo is already decided");
  }
  // Never decide (and so never publish) a photo before its CSAM hash check has passed.
  if (!isHashCleared(row)) {
    throw new ConvexError("Photo has not passed the hash check yet");
  }
  assertDecisionFits(row, decision);
};

// Manual review of a photo nobody has decided: the classifier left it "pending" or "unscored", or
// its CSAM hash check timed out (lib/imageModeration/hashRecheckPool, HASH_CHECK_TIMEOUT_MS). An
// admin approves it (visible to everyone) or rejects it. Admin-only (isAdmin, server-side). The
// decision records `moderatedBy`, which makes it final: a late pipeline verdict is a no-op (first
// verdict wins on pending only) and the re-screen backfill skips the row. Stamped on the audit
// trail as photo_manually_approved / photo_manually_rejected with the admin as actor.
//
// A TIMED-OUT photo is approved only with the explicit decision "waive_hash_check" ("Approve
// without hash check"; plain "approve" is refused for it, and the waiver for any other photo): it
// is published without a hash check, the approval opens the gate (`hashCheckedAt`), records the
// admin (`hashCheckWaivedBy`) and is stamped photo_hash_check_waived. Its stored hashes stay, so a
// re-check that still runs can match it, and a match then quarantines and escalates over the
// approval (a match always wins).
//
// A rejected COPY photo moves to the Flagged Images queue (status "rejected"), where it can be
// restored or its removal confirmed (which deletes it and notifies the uploader), exactly like an
// automatic rejection. A rejected COMPLETION photo gets the same side effects as an automatic
// rejection: it is detached from the completion and its blob deleted. Rejected BOX ART likewise
// (catalog/boxArtModerationStore.detachRejectedBoxArt): detached from every definition and
// proposal holding it and its blob deleted; approved box art is served (boxArtUrl). A CIRCLE ICON
// likewise: a rejected one's blob is deleted (its uploader is told it was removed), an approved
// one becomes the circle's icon (sharing/circleIcons.settleCircleIcon).
//
// A MESSAGE photo (spec 2026-10-20 D5; only a sent, "unscored" one): approve serves it to the
// thread (its message updates in place; the non-mutual blur still applies), which needs a passed
// hash check AND the re-encode (else "Check again" first). Reject is a moderator removal: status
// "removed" (both sides read "Removed by moderation"; the message and its caption stay), its blobs
// and reveals deleted unless a report holds it, and the uploader gets the content_removed
// statement of reasons (decided by a person). Nothing about the conversation is stamped. A sent
// message photo whose hash check timed out is decided the same way, whatever the classifier said
// (an approval keeps a "blurred" verdict blurred).
export const decideUncheckedPhoto = mutation({
  args: {
    source: v.union(
      v.literal("copy"),
      v.literal("completion"),
      v.literal("boxArt"),
      v.literal("message"),
      v.literal("circleIcon"),
    ),
    imageId: v.string(),
    decision: v.union(
      v.literal("approve"),
      v.literal("waive_hash_check"),
      v.literal("reject"),
    ),
  },
  handler: async (ctx, { source, imageId, decision }) => {
    const memberId = (await requireMember(ctx)) as unknown as Id<"users">;
    if (!(await isAdmin(ctx))) throw new ConvexError("Forbidden");

    const now = Date.now();
    const status = decision === "reject" ? "rejected" : "approved";
    const kind =
      decision === "reject"
        ? "photo_manually_rejected"
        : decision === "waive_hash_check"
          ? "photo_hash_check_waived"
          : "photo_manually_approved";
    // The waiver (a timed-out photo, assertDecisionFits) opens the hash gate and leaves the
    // waiting index.
    const release =
      decision === "waive_hash_check"
        ? {
            hashCheckedAt: now,
            hashCheckPendingSince: undefined,
            hashCheckWaivedBy: memberId,
          }
        : {};
    const decided = {
      moderationStatus: status,
      moderationReason: undefined,
      moderatedBy: memberId,
      updatedAt: now,
    } as const;

    if (source === "copy") {
      const id = ctx.db.normalizeId("ownedPuzzleImages", imageId);
      const row = id ? await ctx.db.get(id) : null;
      if (!id || !row) throw new ConvexError("Photo not found");
      assertDecidable(row, decision);
      await ctx.db.patch(id, { ...decided, ...release });
      const copy = await ctx.db.get(row.ownedPuzzleId);
      const title =
        copy?.snapshot?.title ??
        (copy ? (await ctx.db.get(copy.puzzleId))?.title : undefined);
      await stampModerationAction(ctx, {
        actorId: memberId,
        kind,
        targetLabel: title ?? imageId,
        targetId: imageId,
      });
      return;
    }

    if (source === "message") {
      const id = ctx.db.normalizeId("messageAttachments", imageId);
      const row = id ? await ctx.db.get(id) : null;
      if (!id || row?.kind !== "image" || row.messageId === undefined) {
        throw new ConvexError("Photo not found");
      }
      const timedOut = heldByTimeout(row);
      if (!timedOut && row.moderationStatus !== "unscored") {
        throw new ConvexError("Photo is already decided");
      }
      assertDecisionFits(row, decision);
      if (decision !== "reject") {
        if (!timedOut && row.hashCheckedAt === undefined) {
          throw new ConvexError("Photo has not passed the hash check yet");
        }
        if (row.reencodedAt === undefined) {
          throw new ConvexError("Photo has not been re-encoded yet");
        }
        await ctx.db.patch(id, {
          moderationStatus:
            row.moderationStatus === "blurred" ? "blurred" : "approved",
          moderationReason: undefined,
          moderatedBy: memberId,
          updatedAt: now,
          ...release,
        });
      } else {
        await ctx.db.patch(id, {
          moderationStatus: "removed",
          moderationReason: undefined,
          moderatedBy: memberId,
          updatedAt: now,
        });
        await deleteAttachmentBlobs(ctx, row);
        await deleteReveals(ctx, id);
        if (await ctx.db.get(row.uploaderId)) {
          await makeNotify(ctx)({
            memberId: toMemberId(row.uploaderId as string),
            type: "content_removed",
            relatedId: id as string,
            params: {
              restricted: "photo",
              ground: "other",
              reason: "A moderator reviewed this photo and did not approve it.",
              automated: "false",
              redress: REDRESS,
            },
          });
        }
      }
      await stampModerationAction(ctx, {
        actorId: memberId,
        kind,
        targetLabel: MESSAGE_PHOTO_LABEL,
        targetId: imageId,
      });
      return;
    }

    if (source === "boxArt") {
      const id = ctx.db.normalizeId("boxArtUploads", imageId);
      const row = id ? await ctx.db.get(id) : null;
      if (!id || !row) throw new ConvexError("Photo not found");
      assertDecidable(row, decision);
      const title = (await boxArtTitle(ctx, row.storageId)) ?? "Box art";
      await ctx.db.patch(id, {
        moderationStatus: status,
        moderationReason: undefined,
        moderatedBy: memberId,
        ...release,
      });
      if (decision === "reject") await detachRejectedBoxArt(ctx, row);
      await stampModerationAction(ctx, {
        actorId: memberId,
        kind,
        targetLabel: title,
        targetId: imageId,
      });
      return;
    }

    if (source === "circleIcon") {
      const id = ctx.db.normalizeId("circleIcons", imageId);
      const row = id ? await ctx.db.get(id) : null;
      if (!id || !row) throw new ConvexError("Photo not found");
      assertDecidable(row, decision);
      await ctx.db.patch(id, { ...decided, ...release });
      if (decision === "reject") {
        if (!(await isPreservedBlob(ctx, row.fileId))) {
          try {
            await ctx.storage.delete(row.fileId);
          } catch {
            // Already gone.
          }
        }
      } else {
        await settleCircleIcon(ctx, id);
      }
      await stampModerationAction(ctx, {
        actorId: memberId,
        kind,
        targetLabel: CIRCLE_ICON_LABEL,
        targetId: imageId,
      });
      return;
    }

    const id = ctx.db.normalizeId("completionImages", imageId);
    const row = id ? await ctx.db.get(id) : null;
    if (!id || !row) throw new ConvexError("Photo not found");
    assertDecidable(row, decision);
    await ctx.db.patch(id, { ...decided, ...release });
    const title =
      decision === "reject"
        ? await detachRejectedCompletionPhoto(ctx, row)
        : ((
            await ctx.db
              .query("completions")
              .withIndex("by_aggregate_id", (q) =>
                q.eq("aggregateId", row.completionId),
              )
              .unique()
          )?.copySnapshot?.title ?? "Completion photo");
    await stampModerationAction(ctx, {
      actorId: memberId,
      kind,
      targetLabel: title,
      targetId: row.completionId,
    });
  },
});
