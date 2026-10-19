import { v } from "convex/values";
import type { Id } from "../_generated/dataModel";
import { mutation } from "../_generated/server";
import { requireMember } from "../identity/requireMember";
import { requireAcceptableHouseholdLink } from "./householdLinkInvite";

// An EXISTING member declines a household invite link. Same gate as accepting, including a member
// already in a household (who could accept by leaving theirs). Declining CONSUMES the token: a declined link must not stay
// acceptable by mistake later (or by whoever it is forwarded to), and it stops counting toward the
// inviter's open-link limit, so they can mint a fresh one. Silent to the inviter, like declining
// an in-app invite.
export const declineHouseholdLinkInvite = mutation({
  args: { token: v.string() },
  handler: async (ctx, { token }): Promise<null> => {
    const memberId = (await requireMember(ctx)) as unknown as Id<"users">;
    const now = Date.now();
    const link = await requireAcceptableHouseholdLink(
      ctx,
      token,
      memberId,
      now,
      true,
    );
    await ctx.db.patch(link._id, { consumedAt: now, consumedBy: memberId });
    return null;
  },
});
