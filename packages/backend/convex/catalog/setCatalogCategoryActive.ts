import {
  makeSetCatalogCategoryActive,
  toCatalogCategoryId,
} from "@jigswap/domain";
import { v } from "convex/values";
import { mutation } from "../_generated/server";
import { stampModerationAction } from "../admin/stampModerationAction";
import { requireAdmin } from "../identity/isAdmin";
import { convexCatalogCategoryRepository } from "./adapters/convexCatalogCategoryRepository";
import { catalogEventPublisher } from "./adapters/eventPublisher";
import { systemClock } from "./adapters/systemClock";
import { toConvexError } from "./errors";

// Composition root for the soft (de)activation toggle — a node is never deleted, only hidden.
// The aggregate makes the toggle idempotent (no event when unchanged), and so is the audit trail:
// only a real change is stamped (category_deactivated / category_reactivated, SEC-56).
export const setCatalogCategoryActive = mutation({
  args: { catalogCategoryId: v.string(), isActive: v.boolean() },
  handler: async (ctx, args) => {
    const adminId = await requireAdmin(ctx);
    const before = await ctx.db
      .query("adminCategories")
      .withIndex("by_aggregate_id", (q) =>
        q.eq("aggregateId", args.catalogCategoryId),
      )
      .unique();

    const setActive = makeSetCatalogCategoryActive({
      categories: convexCatalogCategoryRepository(ctx),
      events: catalogEventPublisher(ctx),
      clock: systemClock,
    });

    const result = await setActive({
      catalogCategoryId: toCatalogCategoryId(args.catalogCategoryId),
      isActive: args.isActive,
    });
    if (result.isErr) throw toConvexError(result.error);
    if (before && before.isActive !== args.isActive) {
      await stampModerationAction(ctx, {
        actorId: adminId,
        kind: args.isActive ? "category_reactivated" : "category_deactivated",
        targetLabel: before.name.en,
        targetId: args.catalogCategoryId,
      });
    }
  },
});
