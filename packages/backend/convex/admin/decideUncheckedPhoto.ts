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
import { isHashCleared } from "../lib/imageModeration/hashCheckFields";
import { makeNotify } from "../notifications/adapters/makeNotify";
import { detachRejectedCompletionPhoto } from "../solving/completionModerationStore";
import { REDRESS } from "./decideReport";
import { stampModerationAction } from "./stampModerationAction";

// Manual review of a photo the classifier has not decided ("pending" or "unscored"): an admin
// approves it (visible to everyone) or rejects it. Admin-only (isAdmin, server-side). The decision
// records `moderatedBy`, which makes it final: a late pipeline verdict is a no-op (first verdict
// wins on pending only) and the re-screen backfill skips the row. Stamped on the audit trail as
// photo_manually_approved / photo_manually_rejected with the admin as actor.
//
// A rejected COPY photo moves to the Flagged Images queue (status "rejected"), where it can be
// restored or its removal confirmed (which deletes it and notifies the uploader), exactly like an
// automatic rejection. A rejected COMPLETION photo gets the same side effects as an automatic
// rejection: it is detached from the completion and its blob deleted. Rejected BOX ART likewise
// (catalog/boxArtModerationStore.detachRejectedBoxArt): detached from every definition and
// proposal holding it and its blob deleted; approved box art is served (boxArtUrl).
//
// A MESSAGE photo (spec 2026-10-20 D5; only a sent, "unscored" one): approve serves it to the
// thread (its message updates in place; the non-mutual blur still applies), which needs a passed
// hash check AND the re-encode (else "Check again" first). Reject is a moderator removal: status
// "removed" (both sides read "Removed by moderation"; the message and its caption stay), its blobs
// and reveals deleted unless a report holds it, and the uploader gets the content_removed
// statement of reasons (decided by a person). Nothing about the conversation is stamped.
export const decideUncheckedPhoto = mutation({
  args: {
    source: v.union(
      v.literal("copy"),
      v.literal("completion"),
      v.literal("boxArt"),
      v.literal("message"),
    ),
    imageId: v.string(),
    decision: v.union(v.literal("approve"), v.literal("reject")),
  },
  handler: async (ctx, { source, imageId, decision }) => {
    const memberId = (await requireMember(ctx)) as unknown as Id<"users">;
    if (!(await isAdmin(ctx))) throw new ConvexError("Forbidden");

    const status = decision === "approve" ? "approved" : "rejected";
    const kind =
      decision === "approve"
        ? "photo_manually_approved"
        : "photo_manually_rejected";
    const decided = {
      moderationStatus: status,
      moderationReason: undefined,
      moderatedBy: memberId,
      updatedAt: Date.now(),
    } as const;

    if (source === "copy") {
      const id = ctx.db.normalizeId("ownedPuzzleImages", imageId);
      const row = id ? await ctx.db.get(id) : null;
      if (!id || !row) throw new ConvexError("Photo not found");
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
      await ctx.db.patch(id, decided);
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
      if (row.moderationStatus !== "unscored") {
        throw new ConvexError("Photo is already decided");
      }
      const now = Date.now();
      if (decision === "approve") {
        if (row.hashCheckedAt === undefined) {
          throw new ConvexError("Photo has not passed the hash check yet");
        }
        if (row.reencodedAt === undefined) {
          throw new ConvexError("Photo has not been re-encoded yet");
        }
        await ctx.db.patch(id, {
          moderationStatus: "approved",
          moderationReason: undefined,
          moderatedBy: memberId,
          updatedAt: now,
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
      if (
        row.moderationStatus !== "pending" &&
        row.moderationStatus !== "unscored"
      ) {
        throw new ConvexError("Photo is already decided");
      }
      if (!isHashCleared(row)) {
        throw new ConvexError("Photo has not passed the hash check yet");
      }
      const title = (await boxArtTitle(ctx, row.storageId)) ?? "Box art";
      await ctx.db.patch(id, {
        moderationStatus: status,
        moderationReason: undefined,
        moderatedBy: memberId,
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

    const id = ctx.db.normalizeId("completionImages", imageId);
    const row = id ? await ctx.db.get(id) : null;
    if (!id || !row) throw new ConvexError("Photo not found");
    if (
      row.moderationStatus !== "pending" &&
      row.moderationStatus !== "unscored"
    ) {
      throw new ConvexError("Photo is already decided");
    }
    if (!isHashCleared(row)) {
      throw new ConvexError("Photo has not passed the hash check yet");
    }
    await ctx.db.patch(id, decided);
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
