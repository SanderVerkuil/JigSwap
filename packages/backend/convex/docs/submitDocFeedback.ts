import { ConvexError, v } from "convex/values";
import { mutation } from "../_generated/server";

// Hard caps mirror the client-side widget limits; the mutation is public
// (no requireMember) since /docs lives on the marketing site.
const MAX_SLUG = 200;
const MAX_COMMENT = 2000;

// Public docs feedback write (thin adapter): persists a "Was this page helpful?"
// vote for admin review. /docs is public, so no auth is required. Validation is
// duplicated client-side for UX; this is the authoritative check.
export const submitDocFeedback = mutation({
  args: {
    slug: v.string(),
    helpful: v.boolean(),
    comment: v.optional(v.string()),
    locale: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const slug = args.slug.trim();
    if (!slug || slug.length > MAX_SLUG) {
      throw new ConvexError({ code: "invalid_slug" });
    }

    const comment = args.comment?.trim();
    if (comment !== undefined && comment.length > MAX_COMMENT) {
      throw new ConvexError({ code: "invalid_comment" });
    }

    await ctx.db.insert("docFeedback", {
      slug,
      helpful: args.helpful,
      comment: comment && comment.length > 0 ? comment : undefined,
      locale: args.locale,
      createdAt: Date.now(),
    });
  },
});
