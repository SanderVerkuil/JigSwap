import { makeInviteToHousehold, toMemberId } from "@jigswap/domain";
import { ConvexError, v } from "convex/values";
import { mutation } from "../_generated/server";
import { requireMember } from "../identity/requireMember";
import { householdDeps } from "./adapters/deps";
import { toConvexError } from "./errors";

// Composition root: the household admin invites a member (by users _id, picked from member search).
// The inviter is ALWAYS the authenticated member; the use case enforces admin-only, invitee not in a
// household, and one pending invite per invitee. Returns the HouseholdInviteId.
export const inviteToHousehold = mutation({
  args: { inviteeId: v.id("users") },
  handler: async (ctx, args): Promise<string> => {
    const actorId = await requireMember(ctx);
    if (!(await ctx.db.get(args.inviteeId))) {
      throw new ConvexError({
        code: "MemberNotFound",
        message: "No such member",
      });
    }
    const result = await makeInviteToHousehold(householdDeps(ctx))({
      actorId,
      inviteeId: toMemberId(args.inviteeId),
    });
    if (result.isErr) throw toConvexError(result.error);
    return result.value as string;
  },
});
