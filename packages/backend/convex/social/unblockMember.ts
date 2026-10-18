import { v } from "convex/values";
import type { Id } from "../_generated/dataModel";
import { mutation } from "../_generated/server";
import { requireMember } from "../identity/requireMember";
import { enforceRateLimit } from "../lib/rateLimits";

// Unblock a member: delete the caller's block row, if any (idempotent). Follow edges removed by
// the block are NOT restored; messaging works again only where a ConnectionPolicy clause holds.
export const unblockMember = mutation({
  args: { memberId: v.id("users") },
  handler: async (ctx, { memberId: blockedId }): Promise<void> => {
    const blockerId = (await requireMember(ctx)) as unknown as Id<"users">;
    await enforceRateLimit(ctx, "blockToggle", blockerId);

    const rows = await ctx.db
      .query("blocks")
      .withIndex("by_pair", (q) =>
        q.eq("blockerId", blockerId).eq("blockedId", blockedId),
      )
      .collect();
    for (const row of rows) await ctx.db.delete(row._id);
  },
});
