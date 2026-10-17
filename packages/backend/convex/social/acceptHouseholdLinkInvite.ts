import { makeJoinHouseholdByLink, toMemberId } from "@jigswap/domain";
import { v } from "convex/values";
import type { Id } from "../_generated/dataModel";
import { mutation } from "../_generated/server";
import { householdDeps } from "../household/adapters/deps";
import { toConvexError } from "../household/errors";
import { requireMember } from "../identity/requireMember";
import { requireAcceptableHouseholdLink } from "./householdLinkInvite";

// An EXISTING member accepts a household invite link from the signed-in landing. Gated by
// requireAcceptableHouseholdLink (live, unexpired, unused household link; owner still its admin;
// caller is not the owner and in no household), then joined through the domain's
// joinHouseholdByLink: the same invite + accept rules as an in-app invite, and the existing
// household_invite_accepted notification to the admin. Consumes the token. No follow, no
// attribution: this is not a signup. Returns the HouseholdId.
export const acceptHouseholdLinkInvite = mutation({
  args: { token: v.string() },
  handler: async (ctx, { token }): Promise<string> => {
    const actorId = await requireMember(ctx);
    const memberId = actorId as unknown as Id<"users">;
    const now = Date.now();
    const link = await requireAcceptableHouseholdLink(
      ctx,
      token,
      memberId,
      now,
    );

    const joined = await makeJoinHouseholdByLink(householdDeps(ctx))({
      actorId,
      inviterId: toMemberId(link.ownerId),
    });
    if (joined.isErr) throw toConvexError(joined.error);

    await ctx.db.patch(link._id, { consumedAt: now, consumedBy: memberId });
    return joined.value as string;
  },
});
