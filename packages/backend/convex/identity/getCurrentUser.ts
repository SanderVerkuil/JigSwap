import type { CurrentMemberView } from "@jigswap/contracts";
import { query } from "../_generated/server";
import { toCurrentMemberView } from "./toMemberView";

// Identity read (thin adapter): the signed-in member, or null when unauthenticated. Returns the
// self-only CurrentMemberView (includes the caller's own email + clerkId) — safe because it only
// ever returns the caller's own account.
export const getCurrentUser = query({
  args: {},
  handler: async (ctx): Promise<CurrentMemberView | null> => {
    const identity = await ctx.auth.getUserIdentity();
    if (!identity) return null;

    const user = await ctx.db
      .query("users")
      .withIndex("by_clerk_id", (q) => q.eq("clerkId", identity.subject))
      .unique();
    return user ? toCurrentMemberView(user) : null;
  },
});
