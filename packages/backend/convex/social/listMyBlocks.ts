import type { BlockedMemberView } from "@jigswap/contracts";
import type { Id } from "../_generated/dataModel";
import { query } from "../_generated/server";
import { requireMember } from "../identity/requireMember";
import { toMemberView } from "../identity/toMemberView";

// The caller's own block list, newest first, for the "Blocked members" settings list. Only the
// blocker ever sees it. Rows whose member no longer exists are skipped.
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
      const { _id, name, username, avatar } = toMemberView(user);
      views.push({
        memberId: _id,
        name,
        avatar,
        handle: user.slug ?? username ?? _id,
        blockedAt: row.createdAt,
      });
    }
    return views;
  },
});
