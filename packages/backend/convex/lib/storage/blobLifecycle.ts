import { v } from "convex/values";
import type { Id } from "../../_generated/dataModel";
import { internalMutation, type MutationCtx } from "../../_generated/server";
import { isReferenced } from "../imageModeration/blobReferences";

export type BlobDeleteOutcome = "deleted" | "referenced" | "missing";

/**
 * Delete a stored blob unless another row still holds it (lib/imageModeration/blobReferences: a
 * photo, icon, box art, listing, report evidence, or a CSAM escalation that preserves it). Pass
 * the row being removed or swapped as `except` when it still holds the blob at this point. A row
 * written before the claim rule may hold catalogue box art (SEC-01): removing that row must
 * never take the box art with it. A blob already gone is "missing", not an error.
 */
export const deleteBlobUnlessReferenced = async (
  ctx: MutationCtx,
  storageId: Id<"_storage">,
  { except }: { except?: string } = {},
): Promise<BlobDeleteOutcome> => {
  if (!(await ctx.db.system.get(storageId))) return "missing";
  if (await isReferenced(ctx, storageId, { except })) return "referenced";
  await ctx.storage.delete(storageId);
  return "deleted";
};

// For the Node moderation pipeline (no ctx.db): drop an original after a swap or a refusal, in
// one transaction with the reference check.
export const deleteUnlessReferenced = internalMutation({
  args: { storageId: v.id("_storage"), except: v.optional(v.string()) },
  handler: (ctx, { storageId, except }): Promise<BlobDeleteOutcome> =>
    deleteBlobUnlessReferenced(ctx, storageId, { except }),
});
