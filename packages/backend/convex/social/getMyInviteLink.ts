import { Id } from "../_generated/dataModel";
import { mutation } from "../_generated/server";
import { requireMember } from "../identity/requireMember";

// Returns the member's ACTIVE invite token, creating one on first use. A mutation (not a query)
// because the first call writes. The token is opaque (uuid hex) — never derived from the member id,
// so resetting it actually severs old links.
export const getMyInviteLink = mutation({
  args: {},
  handler: async (ctx, _args) => {
    const memberId = (await requireMember(ctx)) as unknown as Id<"users">;

    const rows = await ctx.db
      .query("inviteLinks")
      .withIndex("by_owner", (q) => q.eq("ownerId", memberId))
      .collect();
    const active = rows.find((r) => r.revokedAt === undefined);
    if (active) return { token: active.token };

    const token = crypto.randomUUID().replaceAll("-", "");
    await ctx.db.insert("inviteLinks", {
      ownerId: memberId,
      token,
      createdAt: Date.now(),
      landingViews: 0,
      signupsAttributed: 0,
      followsEstablished: 0,
    });
    return { token };
  },
});
