import { v } from "convex/values";
import { internalMutation, internalQuery } from "../_generated/server";

// Shared validator for the cached draft; mirrors the domain PuzzleImportDraft shape.
// NOTE: schema.ts carries a byte-identical inline copy — the Convex module graph (schema.ts is
// imported by _generated) prevents importing this const there, so keep the two in sync manually.
const draftValidator = v.object({
  title: v.string(),
  brand: v.optional(v.string()),
  imageUrl: v.optional(v.string()),
  images: v.optional(v.array(v.string())),
  description: v.optional(v.string()),
  ean: v.optional(v.string()),
  upc: v.optional(v.string()),
  pieceCount: v.optional(v.number()),
  sourceUrl: v.string(),
});

export const getCachedImport = internalQuery({
  args: { normalizedUrl: v.string() },
  handler: async (ctx, { normalizedUrl }) =>
    ctx.db
      .query("puzzleImportCache")
      .withIndex("by_url", (q) => q.eq("normalizedUrl", normalizedUrl))
      .unique(),
});

export const putCachedImport = internalMutation({
  args: { normalizedUrl: v.string(), draft: draftValidator },
  handler: async (ctx, { normalizedUrl, draft }) => {
    const existing = await ctx.db
      .query("puzzleImportCache")
      .withIndex("by_url", (q) => q.eq("normalizedUrl", normalizedUrl))
      .unique();
    const fetchedAt = Date.now();
    if (existing) await ctx.db.patch(existing._id, { draft, fetchedAt });
    else
      await ctx.db.insert("puzzleImportCache", {
        normalizedUrl,
        draft,
        fetchedAt,
      });
  },
});
