import type { Id } from "../_generated/dataModel";
import type { QueryCtx } from "../_generated/server";

// Identity ACL: resolve the acting member from Clerk auth WITHOUT throwing (unlike
// requireMember): an unauthenticated caller, or one whose Clerk subject has no user row,
// simply yields null. For reads that stay open to anonymous callers but disclose more to
// a signed-in member.
export const optionalActingMember = async (
  ctx: QueryCtx,
): Promise<Id<"users"> | null> => {
  const identity = await ctx.auth.getUserIdentity();
  if (!identity) return null;
  const user = await ctx.db
    .query("users")
    .withIndex("by_clerk_id", (q) => q.eq("clerkId", identity.subject))
    .unique();
  return user?._id ?? null;
};
