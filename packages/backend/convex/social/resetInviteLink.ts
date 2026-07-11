import { Id } from "../_generated/dataModel";
import { mutation } from "../_generated/server";
import { requireMember } from "../identity/requireMember";

// Revoke the active invite token and issue a fresh one. Old rows are kept (revokedAt stamped) so
// historical counters survive; landings on the old token silently degrade to the plain teaser.
export const resetInviteLink = mutation({
  args: {},
  handler: async (ctx, _args) => {
    const memberId = (await requireMember(ctx)) as unknown as Id<"users">;

    const rows = await ctx.db
      .query("inviteLinks")
      .withIndex("by_owner", (q) => q.eq("ownerId", memberId))
      .collect();
    const now = Date.now();
    for (const row of rows) {
      if (row.revokedAt === undefined) {
        await ctx.db.patch(row._id, { revokedAt: now });
      }
    }

    const token = crypto.randomUUID().replaceAll("-", "");
    await ctx.db.insert("inviteLinks", {
      ownerId: memberId,
      token,
      createdAt: now,
      landingViews: 0,
      signupsAttributed: 0,
      followsEstablished: 0,
    });
    return { token };
  },
});
