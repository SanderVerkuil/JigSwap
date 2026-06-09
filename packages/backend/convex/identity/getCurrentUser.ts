import type { MemberView } from "@jigswap/contracts";
import { query } from "../_generated/server";
import { toMemberView } from "./toMemberView";

// Identity read (thin adapter): the signed-in member, or null when unauthenticated. Auth gating and
// the by_clerk_id lookup match the legacy users.getCurrentUser exactly; only the shape is typed now.
export const getCurrentUser = query({
  args: {},
  handler: async (ctx): Promise<MemberView | null> => {
    const identity = await ctx.auth.getUserIdentity();
    if (!identity) return null;

    const user = await ctx.db
      .query("users")
      .withIndex("by_clerk_id", (q) => q.eq("clerkId", identity.subject))
      .unique();
    return user ? toMemberView(user) : null;
  },
});
