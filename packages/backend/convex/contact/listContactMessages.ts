import { ConvexError } from "convex/values";
import { query } from "../_generated/server";
import { isAdmin } from "../identity/isAdmin";
import { requireMember } from "../identity/requireMember";

// Admin triage read for the marketing contact form inbox: every message,
// newest first. Admin-only (requireMember + isAdmin), like the sibling
// catalog admin reads — the table holds visitor names/emails.
export const listContactMessages = query({
  args: {},
  handler: async (ctx) => {
    await requireMember(ctx);
    if (!(await isAdmin(ctx))) throw new ConvexError("Forbidden");
    return await ctx.db.query("contactMessages").order("desc").collect();
  },
});
