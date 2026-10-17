import {
  makeDeclineHouseholdInvite,
  toHouseholdInviteId,
} from "@jigswap/domain";
import { v } from "convex/values";
import { mutation } from "../_generated/server";
import { requireMember } from "../identity/requireMember";
import { householdDeps } from "./adapters/deps";
import { toConvexError } from "./errors";

// Composition root: the invitee declines (silent to the inviter).
export const declineHouseholdInvite = mutation({
  args: { inviteId: v.string() },
  handler: async (ctx, args): Promise<void> => {
    const actorId = await requireMember(ctx);
    const result = await makeDeclineHouseholdInvite(householdDeps(ctx))({
      actorId,
      inviteId: toHouseholdInviteId(args.inviteId),
    });
    if (result.isErr) throw toConvexError(result.error);
  },
});
