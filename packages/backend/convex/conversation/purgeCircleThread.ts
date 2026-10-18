import type { Doc } from "../_generated/dataModel";
import type { MutationCtx } from "../_generated/server";
import { deleteAttachmentBlobs, deleteReveals } from "./messageAttachments";

/**
 * One batch of a deleted circle's thread purge (sharing/purgeDeletedCircle), deleting at most
 * `budget` rows and returning how many it deleted: the messages first, then the attachments,
 * then the participant rows, and the thread row last, once nothing hangs off it. A return equal to
 * `budget` means there may be more; the caller reschedules.
 *
 * Attachments an open report holds (`evidenceHold`) are kept whole, blobs included: with the
 * thread and its messages gone they are detached, reachable only through their report, whose
 * snapshot is never touched here. A quarantined photo is kept whole too (the CSAM preservation owns
 * it). Both stay out of every batch's read, so the purge walks past them.
 *
 * Hygiene, not access control: every thread read gates on the circle membership, which is gone
 * before this runs.
 */
export const purgeCircleThreadBatch = async (
  ctx: MutationCtx,
  circleId: string,
  budget: number,
): Promise<number> => {
  const thread = await ctx.db
    .query("threads")
    .withIndex("by_circle", (q) => q.eq("circleId", circleId))
    .first();
  if (!thread || budget <= 0) return 0;
  const threadId = thread.aggregateId;
  let deleted = 0;

  const messages = await ctx.db
    .query("threadMessages")
    .withIndex("by_thread_sent", (q) => q.eq("threadAggregateId", threadId))
    .take(budget);
  for (const message of messages) await ctx.db.delete(message._id);
  deleted += messages.length;
  if (deleted >= budget) return deleted;

  const attachments = await ctx.db
    .query("messageAttachments")
    .withIndex("by_thread_uploader", (q) => q.eq("threadAggregateId", threadId))
    .filter((q) =>
      q.and(
        q.neq(q.field("evidenceHold"), true),
        q.neq(q.field("moderationStatus"), "quarantined"),
      ),
    )
    .take(budget - deleted);
  for (const attachment of attachments) await deleteAttachment(ctx, attachment);
  deleted += attachments.length;
  if (deleted >= budget) return deleted;

  const participants = await ctx.db
    .query("threadParticipants")
    .withIndex("by_thread", (q) => q.eq("threadAggregateId", threadId))
    .take(budget - deleted);
  for (const participant of participants) await ctx.db.delete(participant._id);
  deleted += participants.length;
  if (deleted >= budget) return deleted;

  await ctx.db.delete(thread._id);
  return deleted + 1;
};

// A purged attachment goes with its blobs and every viewer's reveal of it.
const deleteAttachment = async (
  ctx: MutationCtx,
  row: Doc<"messageAttachments">,
): Promise<void> => {
  await deleteAttachmentBlobs(ctx, row);
  if (row.kind === "image") await deleteReveals(ctx, row._id);
  await ctx.db.delete(row._id);
};
