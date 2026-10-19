import { makeInviteToHousehold, toMemberId } from "@jigswap/domain";
import { ConvexError, v } from "convex/values";
import { mutation } from "../_generated/server";
import { requireMember } from "../identity/requireMember";
import { deleteNotificationsAbout } from "../invitations/fallbacks";
import { isBlockedEitherWay } from "../social/blocks";
import { householdDeps } from "./adapters/deps";
import { toConvexError } from "./errors";

// Composition root: the household admin invites a member (by users _id, picked from member search).
// The inviter is ALWAYS the authenticated member; the use case enforces admin-only, invitee not
// already in THIS household, and one pending invite per invitee. An invitee in another household
// still gets the invite (they can leave theirs on accept); the inviter is not told either way. Returns the HouseholdInviteId.
export const inviteToHousehold = mutation({
  args: { inviteeId: v.id("users") },
  handler: async (ctx, args): Promise<string> => {
    const actorId = await requireMember(ctx);
    // A pair blocked either way reads as a missing member (spec 2.6: generic, never block-specific).
    if (
      !(await ctx.db.get(args.inviteeId)) ||
      (await isBlockedEitherWay(ctx, actorId, args.inviteeId))
    ) {
      throw new ConvexError({
        code: "MemberNotFound",
        message: "No such member",
      });
    }
    // The admin's email invitation may already have reached this member (a pending viaEmail
    // invite, hidden from their pending list). Answering DuplicateInvite would reveal whose
    // address it was, so that invite (and its notification) goes, and this one is made exactly as
    // if it had never existed: the same checks, errors, createdAt and notification.
    const deps = householdDeps(ctx);
    const household = await deps.households.findByMember(actorId);
    if (household?.isAdmin(actorId)) {
      const viaEmail = (
        await ctx.db
          .query("householdInvites")
          .withIndex("by_invitee_status", (q) =>
            q.eq("inviteeId", args.inviteeId).eq("status", "pending"),
          )
          .collect()
      ).find(
        (row) =>
          row.viaEmail === true && row.householdId === (household.id as string),
      );
      if (viaEmail !== undefined) {
        await deleteNotificationsAbout(
          ctx,
          viaEmail.inviteeId,
          "household_invite_received",
          viaEmail.aggregateId,
        );
        await ctx.db.delete(viaEmail._id);
      }
    }
    const result = await makeInviteToHousehold(deps)({
      actorId,
      inviteeId: toMemberId(args.inviteeId),
    });
    if (result.isErr) throw toConvexError(result.error);
    return result.value as string;
  },
});
