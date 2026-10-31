import { ConvexError, v } from "convex/values";
import type { Id } from "../_generated/dataModel";
import { mutation } from "../_generated/server";
import { stampModerationAction } from "../admin/stampModerationAction";
import { isAdmin } from "../identity/isAdmin";
import { requireMember } from "../identity/requireMember";

// The audit label of a contact message: never the sender's name, email or text (personal data the
// audit trail would otherwise keep after the message itself is gone).
export const CONTACT_MESSAGE_LABEL = "Contact message";

// Admin triage write: mark a contact-form message as handled (new -> handled;
// reopenContactMessage is its Undo). Admin-only, mirroring listContactMessages. The transition is
// stamped on the admin audit trail (contact_message_handled, SEC-56); re-marking a handled
// message is a no-op and stamps nothing.
export const markContactMessageHandled = mutation({
  args: { id: v.id("contactMessages") },
  handler: async (ctx, args) => {
    const adminId = (await requireMember(ctx)) as unknown as Id<"users">;
    if (!(await isAdmin(ctx))) throw new ConvexError("Forbidden");
    const message = await ctx.db.get(args.id);
    if (!message) throw new ConvexError({ code: "message_not_found" });
    if (message.status === "handled") return;
    await ctx.db.patch(args.id, { status: "handled" });
    await stampModerationAction(ctx, {
      actorId: adminId,
      kind: "contact_message_handled",
      targetLabel: CONTACT_MESSAGE_LABEL,
      targetId: args.id,
    });
  },
});
