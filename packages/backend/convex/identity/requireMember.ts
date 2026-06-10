import { type MemberId, toMemberId } from "@jigswap/domain";
import { ConvexError } from "convex/values";
import type { QueryCtx } from "../_generated/server";

// Identity ACL: resolve the acting member from Clerk auth instead of trusting a client-supplied
// id. The Clerk subject maps to a user via `by_clerk_id`; the user's _id is the domain MemberId.
export const requireMember = async (ctx: QueryCtx): Promise<MemberId> => {
  const identity = await ctx.auth.getUserIdentity();
  if (!identity) throw new ConvexError("Unauthenticated");

  const user = await ctx.db
    .query("users")
    .withIndex("by_clerk_id", (q) => q.eq("clerkId", identity.subject))
    .unique();
  if (!user) throw new ConvexError("Member not found");

  return toMemberId(user._id);
};
