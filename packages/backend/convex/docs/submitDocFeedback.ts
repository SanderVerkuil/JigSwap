import { ConvexError, v } from "convex/values";
import { mutation } from "../_generated/server";
import { chargeBudget, DOC_FEEDBACK_BUDGET } from "../lib/rateLimits";

// Hard caps mirror the client-side widget limits; the mutation is public
// (no requireMember) since /docs lives on the marketing site, so a
// deployment-wide budget (DOC_FEEDBACK_BUDGET) bounds how many votes land.
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
    locale: v.optional(v.union(v.literal("en"), v.literal("nl"))),
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

    // Charged only for a valid vote, so malformed requests never use it up. Refusals are not
    // logged one by one (anyone can loop this); the window filling is logged once.
    const retryAfterMs = await chargeBudget(ctx, DOC_FEEDBACK_BUDGET, 1, {
      logRefusals: false,
    });
    if (retryAfterMs !== null) {
      throw new ConvexError({ code: "RateLimited", retryAfterMs });
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
