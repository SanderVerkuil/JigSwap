import { internalMutation } from "../_generated/server";

// One-shot migration: legacy adminCategories rows predate aggregateId, so the domain path
// (repository keyed on by_aggregate_id) can't load them — the admin UI disables edit/deactivate
// for them and listActive filters them out of the public taxonomy. Stamp a fresh
// CatalogCategoryId on every row still missing one. Idempotent: stamped rows are skipped.
// Run manually: npx convex run catalog/backfillCategories:run
export const run = internalMutation({
  args: {},
  handler: async (ctx) => {
    const categories = await ctx.db.query("adminCategories").collect();

    let patched = 0;
    for (const category of categories) {
      if (category.aggregateId) continue;
      await ctx.db.patch(category._id, { aggregateId: crypto.randomUUID() });
      patched += 1;
    }
    return { total: categories.length, patched };
  },
});
