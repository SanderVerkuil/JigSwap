import type { ProfileView } from "@jigswap/contracts";
import type { Id } from "../_generated/dataModel";
import { query } from "../_generated/server";
import { requireMember } from "../identity/requireMember";
import { toProfileView } from "./readViews";

// Read side: the acting member's own profile, or null if they have none yet. Auth-gated. Another
// member's profile is read through getPublicProfile, which owns the block and unlock rules.
export const getProfile = query({
  args: {},
  handler: async (ctx): Promise<ProfileView | null> => {
    const viewer = (await requireMember(ctx)) as unknown as Id<"users">;
    const row = await ctx.db
      .query("profiles")
      .withIndex("by_member", (q) => q.eq("memberId", viewer))
      .unique();
    return row ? toProfileView(row) : null;
  },
});
