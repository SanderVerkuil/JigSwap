import {
  makeUpdateCatalogCategory,
  toCatalogCategoryId,
} from "@jigswap/domain";
import { ConvexError, v } from "convex/values";
import type { Id } from "../_generated/dataModel";
import { mutation } from "../_generated/server";
import { stampModerationAction } from "../admin/stampModerationAction";
import { isAdmin } from "../identity/isAdmin";
import { requireMember } from "../identity/requireMember";
import { convexCatalogCategoryRepository } from "./adapters/convexCatalogCategoryRepository";
import { catalogEventPublisher } from "./adapters/eventPublisher";
import { systemClock } from "./adapters/systemClock";
import { toConvexError } from "./errors";

const localized = v.object({ en: v.string(), nl: v.string() });

// Composition root for patching a node's presentation fields. A replacement name must stay
// complete in every locale (enforced by the aggregate). Stamped on the admin audit trail
// (category_updated, labelled with the English name after the update, SEC-56).
export const updateCatalogCategory = mutation({
  args: {
    catalogCategoryId: v.string(),
    name: v.optional(localized),
    description: v.optional(localized),
    color: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const adminId = (await requireMember(ctx)) as unknown as Id<"users">;
    if (!(await isAdmin(ctx))) throw new ConvexError("Forbidden");

    const update = makeUpdateCatalogCategory({
      categories: convexCatalogCategoryRepository(ctx),
      events: catalogEventPublisher(ctx),
      clock: systemClock,
    });

    const result = await update({
      catalogCategoryId: toCatalogCategoryId(args.catalogCategoryId),
      changes: {
        name: args.name,
        description: args.description,
        color: args.color,
      },
    });
    if (result.isErr) throw toConvexError(result.error);
    // The update succeeded, so the row exists.
    const row = await ctx.db
      .query("adminCategories")
      .withIndex("by_aggregate_id", (q) =>
        q.eq("aggregateId", args.catalogCategoryId),
      )
      .unique();
    await stampModerationAction(ctx, {
      actorId: adminId,
      kind: "category_updated",
      targetLabel: row?.name.en ?? args.catalogCategoryId,
      targetId: args.catalogCategoryId,
    });
  },
});
