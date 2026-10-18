import { v } from "convex/values";
import type { Id } from "../_generated/dataModel";
import { mutation } from "../_generated/server";
import { requireMember } from "../identity/requireMember";
import {
  findPresencePreferences,
  presenceOverrideValidator,
} from "./presencePreferences";

// The member sets their own presence sharing and/or override (member from auth; own row only).
// An omitted field keeps its current value.
export const setPresencePreferences = mutation({
  args: {
    share: v.optional(v.boolean()),
    override: v.optional(presenceOverrideValidator),
  },
  handler: async (ctx, { share, override }): Promise<null> => {
    const memberId = (await requireMember(ctx)) as unknown as Id<"users">;
    const updatedAt = Date.now();
    const existing = await findPresencePreferences(ctx, memberId);
    if (existing) {
      await ctx.db.patch(existing._id, {
        ...(share !== undefined && { share }),
        ...(override !== undefined && { override }),
        updatedAt,
      });
    } else {
      await ctx.db.insert("presencePreferences", {
        memberId,
        share,
        override: override ?? "auto",
        updatedAt,
      });
    }
    return null;
  },
});
