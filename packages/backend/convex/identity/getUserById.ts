import type { MemberView } from "@jigswap/contracts";
import { v } from "convex/values";
import type { Id } from "../_generated/dataModel";
import { query } from "../_generated/server";
import { areMutualFollowers, profileVisibilityOf } from "../social/privacy";
import { requireMember } from "./requireMember";
import { toMemberView } from "./toMemberView";

// Identity read (thin adapter): a member by their _id. Authenticated members only; emits the
// PII-free MemberView. Honours the profile-visibility chokepoint (see social/privacy.ts): a member
// who went "private" is hidden (returns null) from everyone except themselves and their mutual
// followers, so private identities can't be enumerated id-by-id. Default/unset visibility is public.
export const getUserById = query({
  args: { userId: v.id("users") },
  handler: async (ctx, args): Promise<MemberView | null> => {
    const viewer = (await requireMember(ctx)) as unknown as Id<"users">;
    const target = args.userId;

    const user = await ctx.db.get(target);
    if (!user) return null;

    // Visibility ACL: a private member is visible only to themselves and their mutual followers.
    if (
      target !== viewer &&
      (await profileVisibilityOf(ctx, target)) === "private" &&
      !(await areMutualFollowers(ctx, viewer, target))
    ) {
      return null;
    }

    return toMemberView(user);
  },
});
