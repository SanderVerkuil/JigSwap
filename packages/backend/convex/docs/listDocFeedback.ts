import { ConvexError } from "convex/values";
import { query } from "../_generated/server";
import { isAdmin } from "../identity/isAdmin";
import { requireMember } from "../identity/requireMember";

// Admin triage read for the public /docs "Was this page helpful?" votes:
// every entry, newest first. Admin-only (requireMember + isAdmin), like the
// sibling contact-message triage read.
export const listDocFeedback = query({
  args: {},
  handler: async (ctx) => {
    await requireMember(ctx);
    if (!(await isAdmin(ctx))) throw new ConvexError("Forbidden");
    return await ctx.db.query("docFeedback").order("desc").collect();
  },
});
