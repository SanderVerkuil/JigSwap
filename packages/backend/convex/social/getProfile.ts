import type { ProfileView } from "@jigswap/contracts";
import { v } from "convex/values";
import type { Id } from "../_generated/dataModel";
import { query } from "../_generated/server";
import { requireMember } from "../identity/requireMember";
import { toProfileView } from "./readViews";

// Read side: a member's public profile, or null if they have none yet. When `memberId` is omitted
// the acting member's own profile is returned (auth-gated). Returns a typed ProfileView DTO.
export const getProfile = query({
  args: { memberId: v.optional(v.id("users")) },
  handler: async (ctx, args): Promise<ProfileView | null> => {
    const memberId =
      args.memberId ?? ((await requireMember(ctx)) as unknown as Id<"users">);
    const row = await ctx.db
      .query("profiles")
      .withIndex("by_member", (q) => q.eq("memberId", memberId))
      .unique();
    return row ? toProfileView(row) : null;
  },
});
