import type { MemberView } from "@jigswap/contracts";
import { v } from "convex/values";
import { query } from "../_generated/server";
import { toMemberView } from "./toMemberView";

// Identity read (thin adapter): resolve a member by Clerk subject. Matches legacy
// users.getUserByClerkId; most callers use it only to obtain the member _id.
export const getUserByClerkId = query({
  args: { clerkId: v.string() },
  handler: async (ctx, args): Promise<MemberView | null> => {
    const user = await ctx.db
      .query("users")
      .withIndex("by_clerk_id", (q) => q.eq("clerkId", args.clerkId))
      .unique();
    return user ? toMemberView(user) : null;
  },
});
