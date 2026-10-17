import { ConvexError, v } from "convex/values";
import type { Id } from "../_generated/dataModel";
import { mutation } from "../_generated/server";
import { requireMember } from "./requireMember";

// Matches the profile field's limit (a city, not an address).
const MAX_LOCATION_LENGTH = 80;

// Set (or clear) the acting member's location (users.location), shown on their profile. Used by
// the quick start's "Make it yours" step. Only the caller's own row is patched, never a
// client-supplied id. Trimmed; empty clears it; longer than 80 characters is `invalid_location`.
export const setLocation = mutation({
  args: { location: v.string() },
  handler: async (ctx, { location }): Promise<null> => {
    const memberId = await requireMember(ctx);
    const trimmed = location.trim();
    if (trimmed.length > MAX_LOCATION_LENGTH) {
      throw new ConvexError({ code: "invalid_location" });
    }
    await ctx.db.patch(memberId as unknown as Id<"users">, {
      location: trimmed === "" ? undefined : trimmed,
      updatedAt: Date.now(),
    });
    return null;
  },
});
