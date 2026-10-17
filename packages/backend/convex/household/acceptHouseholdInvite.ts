import {
  makeAcceptHouseholdInvite,
  toHouseholdInviteId,
} from "@jigswap/domain";
import { v } from "convex/values";
import { mutation } from "../_generated/server";
import { requireMember } from "../identity/requireMember";
import { householdDeps } from "./adapters/deps";
import { toConvexError } from "./errors";

// Composition root: the invitee accepts and joins the household. The use case is the authoritative
// at-most-one-household check (the invitee may have joined another household since the invite).
export const acceptHouseholdInvite = mutation({
  args: { inviteId: v.string() },
  handler: async (ctx, args): Promise<string> => {
    const actorId = await requireMember(ctx);
    const result = await makeAcceptHouseholdInvite(householdDeps(ctx))({
      actorId,
      inviteId: toHouseholdInviteId(args.inviteId),
    });
    if (result.isErr) throw toConvexError(result.error);
    return result.value as string;
  },
});
