import type { MemberView } from "@jigswap/contracts";
import { v } from "convex/values";
import type { Id } from "../_generated/dataModel";
import { query } from "../_generated/server";
import { requireMember } from "./requireMember";
import { toMemberView } from "./toMemberView";

// Identity read (thin adapter): resolve the SIGNED-IN member by their own Clerk subject. Every
// caller looks up itself to obtain its member _id. Any other member's Clerk id reads as not found
// (null): this read applies no profile-visibility rules, so it must never return someone else's
// MemberView (bio, location) — use getUserById for other members (#282).
export const getUserByClerkId = query({
  args: { clerkId: v.string() },
  handler: async (ctx, args): Promise<MemberView | null> => {
    const viewer = (await requireMember(ctx)) as unknown as Id<"users">;
    const user = await ctx.db
      .query("users")
      .withIndex("by_clerk_id", (q) => q.eq("clerkId", args.clerkId))
      .unique();
    if (!user || user._id !== viewer) return null;
    return toMemberView(user);
  },
});
