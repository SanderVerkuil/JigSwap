import {
  makeDeleteCompletion,
  toCompletionId,
  type MemberId,
} from "@jigswap/domain";
import { v } from "convex/values";
import { mutation } from "../_generated/server";
import { requireMember } from "../identity/requireMember";
import { deleteRenditions } from "../lib/imageModeration/renditionsStore";
import { deleteBlobUnlessReferenced } from "../lib/storage/blobLifecycle";
import { convexCompletionRepository } from "./adapters/convexCompletionRepository";
import { inProcessEventPublisher } from "./adapters/inProcessEventPublisher";
import { systemClock } from "./adapters/systemClock";
import { toConvexError } from "./errors";

// Composition root for deleting a completion the acting member owns. No edit-window restriction —
// a member may delete their own completion at any time (e.g. logged by accident). Ownership is
// enforced in the use case; deletion triggers an in-process goal recompute in the same transaction.
// Photo sidecars (and their blobs) are cascaded after a successful delete — captured BEFORE the
// use case runs since the completions row is gone afterwards.
export const deleteCompletion = mutation({
  args: {
    completionId: v.string(),
  },
  handler: async (ctx, args) => {
    const actingMemberId = await requireMember(ctx);

    const row = await ctx.db
      .query("completions")
      .withIndex("by_aggregate_id", (q) =>
        q.eq("aggregateId", args.completionId),
      )
      .unique();

    const del = makeDeleteCompletion({
      completions: convexCompletionRepository(ctx),
      events: inProcessEventPublisher(ctx),
      clock: systemClock,
    });
    const result = await del({
      actingMemberId: actingMemberId as unknown as MemberId,
      completionId: toCompletionId(args.completionId),
    });
    if (result.isErr) throw toConvexError(result.error);

    if (row) {
      const images = await ctx.db
        .query("completionImages")
        .withIndex("by_completion", (q) =>
          q.eq("completionId", args.completionId),
        )
        .collect();
      // Blob sources: the UNION of the row's photos and the sidecars' fileIds. After the
      // moderation re-encode swap they briefly reference different blobs, and a rejected photo's
      // sidecar keeps a fileId that already left `photos` — the union covers every blob either
      // side still references. Tolerate already-deleted blobs (a rejected photo's blob is gone);
      // don't fail the whole delete over a missing file.
      const fileIds = new Set([...row.photos, ...images.map((i) => i.fileId)]);
      for (const image of images) {
        await ctx.db.delete(image._id);
      }
      for (const fileId of fileIds) {
        // A blob anything else still holds stays: a CSAM escalation preserves it (the escalation
        // row keeps it findable for the operator after the sidecar is gone), or a row written
        // before the claim rule holds the same id, such as catalogue box art (SEC-01). Its
        // renditions go in any case (reads fall back to the original).
        await deleteRenditions(ctx, fileId);
        await deleteBlobUnlessReferenced(ctx, fileId);
      }
    }
  },
});
