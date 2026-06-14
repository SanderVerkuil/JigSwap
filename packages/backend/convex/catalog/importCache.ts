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
  imageAlts: v.optional(v.record(v.string(), v.string())),
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

// Ops: flush cached import drafts so a fetcher fix (e.g. honouring <base href>) isn't masked by
// stale drafts for the full TTL. A cached draft that still has a title/images is "usable" and would
// otherwise be served verbatim. Pass `normalizedUrl` to drop one entry, or omit to flush all.
// Run with `npx convex run catalog/importCache:clearImportCache '{}'`.
export const clearImportCache = internalMutation({
  args: { normalizedUrl: v.optional(v.string()) },
  handler: async (ctx, { normalizedUrl }) => {
    const rows = normalizedUrl
      ? await ctx.db
          .query("puzzleImportCache")
          .withIndex("by_url", (q) => q.eq("normalizedUrl", normalizedUrl))
          .collect()
      : await ctx.db.query("puzzleImportCache").collect();
    for (const row of rows) await ctx.db.delete(row._id);
    return { deleted: rows.length };
  },
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
