import { ConvexError, v } from "convex/values";
import { mutation } from "../_generated/server";
import { isAdmin } from "../identity/isAdmin";
import { requireMember } from "../identity/requireMember";

// Admin triage write: mark a contact-form message as handled (the only status
// transition — new -> handled). Admin-only, mirroring listContactMessages.
export const markContactMessageHandled = mutation({
  args: { id: v.id("contactMessages") },
  handler: async (ctx, args) => {
    await requireMember(ctx);
    if (!(await isAdmin(ctx))) throw new ConvexError("Forbidden");
    const message = await ctx.db.get(args.id);
    if (!message) throw new ConvexError({ code: "message_not_found" });
    await ctx.db.patch(args.id, { status: "handled" });
  },
});
