import { ConvexError, v } from "convex/values";
import type { Id } from "../_generated/dataModel";
import { mutation } from "../_generated/server";
import { requireMember } from "./requireMember";

// Matches the profile field's limit (a city, not an address).
const MAX_LOCATION_LENGTH = 80;

// The users.location a write leaves, shared by every path that writes it (setLocation here and
// users.updateUserProfile): trimmed; empty clears it (undefined); longer than 80 characters is
// `invalid_location`, unless it is the location already stored: a value saved before the cap
// stays as it is when an editor sends it back unchanged.
export const normalizeLocation = (
  location: string,
  current: string | undefined,
): string | undefined => {
  const trimmed = location.trim();
  if (trimmed === "") return undefined;
  if (trimmed.length > MAX_LOCATION_LENGTH && trimmed !== current?.trim()) {
    throw new ConvexError({ code: "invalid_location" });
  }
  return trimmed;
};

// Set (or clear) the acting member's location (users.location), shown on their profile. Used by
// the quick start's "Make it yours" step. Only the caller's own row is patched, never a
// client-supplied id. Validated by normalizeLocation.
export const setLocation = mutation({
  args: { location: v.string() },
  handler: async (ctx, { location }): Promise<null> => {
    const memberId = await requireMember(ctx);
    const userId = memberId as unknown as Id<"users">;
    const current = (await ctx.db.get(userId))?.location;
    await ctx.db.patch(userId, {
      location: normalizeLocation(location, current),
      updatedAt: Date.now(),
    });
    return null;
  },
});
