import {
  makeRevokeHouseholdInvite,
  toHouseholdInviteId,
} from "@jigswap/domain";
import { ConvexError, v } from "convex/values";
import { mutation } from "../_generated/server";
import { requireMember } from "../identity/requireMember";
import { deleteNotificationsAbout } from "../invitations/fallbacks";
import { householdDeps } from "./adapters/deps";
import { toConvexError } from "./errors";

// Composition root: the household admin revokes a pending in-app invite (the Members tab's
// pending list). The invite goes with the invitee's notification about it, as if it had never
// been sent. An email invitation's in-app invite (viaEmail) is not revocable here: the admin
// never saw it by name and revokes the email invitation instead (invitations/revokeEmailInvite),
// so it answers exactly like an unknown invite.
export const revokeHouseholdInvite = mutation({
  args: { inviteId: v.string() },
  handler: async (ctx, args): Promise<void> => {
    const actorId = await requireMember(ctx);
    const row = await ctx.db
      .query("householdInvites")
      .withIndex("by_aggregate_id", (q) => q.eq("aggregateId", args.inviteId))
      .unique();
    if (row?.viaEmail === true) {
      throw new ConvexError({
        code: "InviteNotFound",
        message: "No such household invite",
      });
    }
    const result = await makeRevokeHouseholdInvite(householdDeps(ctx))({
      actorId,
      inviteId: toHouseholdInviteId(args.inviteId),
    });
    if (result.isErr) throw toConvexError(result.error);
    if (row) {
      await deleteNotificationsAbout(
        ctx,
        row.inviteeId,
        "household_invite_received",
        row.aggregateId,
      );
    }
  },
});
