import { ConvexError, v } from "convex/values";
import { mutation } from "../_generated/server";
import { stampModerationAction } from "../admin/stampModerationAction";
import { requireAdmin } from "../identity/isAdmin";
import { CONTACT_MESSAGE_LABEL } from "./markContactMessageHandled";

// Admin triage write: put a handled contact-form message back to new — the
// Undo of markContactMessageHandled (handled -> new). Admin-only, mirroring
// markContactMessageHandled. The transition is stamped on the admin audit trail
// (contact_message_reopened, SEC-56); reopening a new message is a no-op and stamps nothing.
export const reopenContactMessage = mutation({
  args: { id: v.id("contactMessages") },
  handler: async (ctx, args) => {
    const adminId = await requireAdmin(ctx);
    const message = await ctx.db.get(args.id);
    if (!message) throw new ConvexError({ code: "message_not_found" });
    if (message.status === "new") return;
    await ctx.db.patch(args.id, { status: "new" });
    await stampModerationAction(ctx, {
      actorId: adminId,
      kind: "contact_message_reopened",
      targetLabel: CONTACT_MESSAGE_LABEL,
      targetId: args.id,
    });
  },
});
