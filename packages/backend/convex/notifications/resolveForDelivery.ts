import type { Doc, Id } from "../_generated/dataModel";
import { internalQuery } from "../_generated/server";
import { deliveryContentOf, deliveryResolutionArgs } from "./deliveryContent";
import {
  createNotificationViewCache,
  resolveNotificationView,
} from "./resolveNotificationView";

// Send-time resolution for the out-of-band channels: the email and push actions call this with the
// delivery's refs, and it runs the SAME resolver as the in-app read model for the recipient, so
// email and push show exactly the actor, context and deep link the bell would. It resolves from the
// delivery payload rather than the persisted row, because a member may have in-app disabled (then
// no row exists).
//
// Returns null when the recipient must not get it at all: their account is deleted, an admin-only type for a recipient who is
// no longer an admin, or a circle invite or connection offer that is no longer on offer. There is no JWT in a scheduled action, so admin status comes from the
// recipient's `users.role` mirror (the same source the subscriber's admin fan-out targets).
export const resolveForDelivery = internalQuery({
  args: deliveryResolutionArgs,
  handler: async (ctx, args) => {
    const recipient = await ctx.db.get(args.recipientId);
    // A deleted (or tombstoned) account gets nothing that was still due when it went.
    if (!recipient || !recipient.isActive) return null;
    const cache = createNotificationViewCache({
      viewerIsAdmin: recipient?.role === "admin",
    });
    // The row the in-app channel would persist for this delivery (toRow), minus the storage ids.
    const row: Doc<"notifications"> = {
      _id: "" as Id<"notifications">,
      _creationTime: 0,
      userId: args.recipientId,
      type: args.type,
      ...(args.params !== undefined ? { params: args.params } : {}),
      ...(args.relatedId !== undefined ? { relatedId: args.relatedId } : {}),
      ...(args.actorId !== undefined
        ? { actorIds: [args.actorId], actorCount: 1 }
        : {}),
      ...(args.subject !== undefined ? { subject: args.subject } : {}),
      isRead: false,
      createdAt: Date.now(),
    };
    const view = await resolveNotificationView(
      ctx,
      args.recipientId,
      row,
      cache,
    );
    if (!view) return null;
    // A circle invite that is no longer on offer (answered, revoked, expired, its inviter blocked
    // or no longer an Admin) is not emailed or pushed at all. Nor is a connection offer that is no
    // longer open (answered, expired, or gone with its inviter's account).
    if (
      (args.type === "circle_invite_received" ||
        args.type === "connection_offer_received") &&
      view.state === "unavailable"
    ) {
      return null;
    }
    return deliveryContentOf(view, args.params, args.actorId !== undefined);
  },
});
