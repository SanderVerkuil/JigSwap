import type { MemberView } from "@jigswap/contracts";
import { v } from "convex/values";
import type { Id } from "../_generated/dataModel";
import { query } from "../_generated/server";
import { blockStateBetween } from "../social/blocks";
import { requireMember } from "./requireMember";
import { toMemberView } from "./toMemberView";

// Identity read (thin adapter): resolve a member by Clerk subject. Authenticated members only;
// most callers use it only to obtain the member _id. Emits the PII-free MemberView. A member who
// blocked the viewer reads as not found (null), as getUserById.
export const getUserByClerkId = query({
  args: { clerkId: v.string() },
  handler: async (ctx, args): Promise<MemberView | null> => {
    const viewer = (await requireMember(ctx)) as unknown as Id<"users">;
    const user = await ctx.db
      .query("users")
      .withIndex("by_clerk_id", (q) => q.eq("clerkId", args.clerkId))
      .unique();
    if (!user) return null;
    if ((await blockStateBetween(ctx, viewer, user._id)) === "byThem") {
      return null;
    }
    return toMemberView(user);
  },
});
