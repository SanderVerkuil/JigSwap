import type { ProfileView } from "@jigswap/contracts";
import { v } from "convex/values";
import type { Id } from "../_generated/dataModel";
import { query } from "../_generated/server";
import { requireMember } from "../identity/requireMember";
import { areMutualFollowers } from "./privacy";
import { toProfileView } from "./readViews";

// Read side: a member's profile, or null if they have none yet. When `memberId` is omitted the
// acting member's own profile is returned. Always auth-gated: the acting member is resolved
// UNCONDITIONALLY (passing a memberId must not bypass authentication). A profile whose visibility is
// "private" is hidden from everyone except the owner and the member's mutual followers. Returns a
// typed ProfileView DTO.
export const getProfile = query({
  args: { memberId: v.optional(v.id("users")) },
  handler: async (ctx, args): Promise<ProfileView | null> => {
    const viewer = (await requireMember(ctx)) as unknown as Id<"users">;
    const target = args.memberId ?? viewer;

    const row = await ctx.db
      .query("profiles")
      .withIndex("by_member", (q) => q.eq("memberId", target))
      .unique();
    if (!row) return null;

    // Visibility ACL: a private profile is visible only to its owner and to mutual followers.
    if (
      row.visibility === "private" &&
      target !== viewer &&
      !(await areMutualFollowers(ctx, viewer, target))
    ) {
      return null;
    }

    return toProfileView(row);
  },
});
