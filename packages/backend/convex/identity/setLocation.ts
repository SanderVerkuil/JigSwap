import { v } from "convex/values";
import type { Id } from "../_generated/dataModel";
import { mutation } from "../_generated/server";
import { normalizeLocation } from "../users";
import { requireMember } from "./requireMember";

// shortcut: kept for web builds from before the ponytail review stack; delete after the next prod web deploy.
// Sets (or clears, with "") the caller's own location, as users.updateUserProfile({ location })
// does: only the caller's row, through normalizeLocation.
export const setLocation = mutation({
  args: { location: v.string() },
  handler: async (ctx, { location }): Promise<null> => {
    const userId = (await requireMember(ctx)) as unknown as Id<"users">;
    const current = (await ctx.db.get(userId))?.location;
    await ctx.db.patch(userId, {
      location: normalizeLocation(location, current),
      updatedAt: Date.now(),
    });
    return null;
  },
});
