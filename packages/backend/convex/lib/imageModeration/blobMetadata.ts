import { v } from "convex/values";
import { internalQuery } from "../../_generated/server";

// The stored blob's size, for the moderation pipeline's size guard BEFORE it downloads the bytes.
// A Node action has no `ctx.db`, so it reads the `_storage` system table through this query.
// Returns null when the blob is gone.
export const getBlobSize = internalQuery({
  args: { storageId: v.id("_storage") },
  handler: async (ctx, { storageId }) => {
    const meta = await ctx.db.system.get(storageId);
    return meta ? meta.size : null;
  },
});
