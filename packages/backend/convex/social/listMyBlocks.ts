import type { BlockedMemberView } from "@jigswap/contracts";
import type { Id } from "../_generated/dataModel";
import { query } from "../_generated/server";
import { requireMember } from "../identity/requireMember";
import { memberTeaserIdentityOf } from "./privacy";

// The caller's own block list, newest first, for the "Blocked members" settings list. Only the
// blocker ever sees it. Rows whose member no longer exists are skipped. A member appears with the
// identity their own direct link shows any signed-in member (memberTeaserIdentityOf, SEC-10):
// anyone can block any member id, so the account name behind a chosen display name must not show
// here.
export const listMyBlocks = query({
  args: {},
  handler: async (ctx): Promise<BlockedMemberView[]> => {
    const me = (await requireMember(ctx)) as unknown as Id<"users">;
    const rows = await ctx.db
      .query("blocks")
      .withIndex("by_blocker", (q) => q.eq("blockerId", me))
      .order("desc")
      .collect();
    const views: BlockedMemberView[] = [];
    for (const row of rows) {
      const user = await ctx.db.get(row.blockedId);
      if (!user) continue;
      const profile = await ctx.db
        .query("profiles")
        .withIndex("by_member", (q) => q.eq("memberId", row.blockedId))
        .unique();
      const identity = memberTeaserIdentityOf(user, profile, true);
      views.push({
        memberId: identity.memberId,
        name: identity.displayName,
        avatar: identity.avatar,
        // Never the username, which another member may hold as a slug (SEC-07).
        handle: user.slug ?? user._id,
        blockedAt: row.createdAt,
      });
    }
    return views;
  },
});
