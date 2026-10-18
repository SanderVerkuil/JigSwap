import { makeExpireCircleInvite, toCircleInviteId } from "@jigswap/domain";
import { v } from "convex/values";
import { internalMutation } from "../_generated/server";
import { circleInviteDeps } from "./adapters/circleInviteDeps";

// Scheduled at an invite's expiresAt (by the sharing publisher on CircleInviteIssued): flips it to
// expired if it is still pending. A no-op for an invite already accepted, declined or revoked.
export const expireCircleInvite = internalMutation({
  args: { inviteId: v.string() },
  handler: async (ctx, args): Promise<boolean> =>
    makeExpireCircleInvite(circleInviteDeps(ctx))({
      inviteId: toCircleInviteId(args.inviteId),
    }),
});
