import {
  isValidSortOrder,
  makeReorderCatalogCategories,
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

// Composition root for reordering several taxonomy nodes at once. The use case loads every
// targeted node first (any missing => CatalogCategoryNotFound, before any write). One reorder is
// one audit row (categories_reordered, SEC-56), however many nodes moved.
export const reorderCatalogCategories = mutation({
  args: {
    order: v.array(
      v.object({ catalogCategoryId: v.string(), sortOrder: v.number() }),
    ),
  },
  handler: async (ctx, args) => {
    const adminId = (await requireMember(ctx)) as unknown as Id<"users">;
    if (!(await isAdmin(ctx))) throw new ConvexError("Forbidden");
    if (!args.order.every((entry) => isValidSortOrder(entry.sortOrder))) {
      throw new ConvexError({
        code: "InvalidSortOrder",
        message: "Not a position in the taxonomy",
      });
    }

    const reorder = makeReorderCatalogCategories({
      categories: convexCatalogCategoryRepository(ctx),
      events: catalogEventPublisher(ctx),
      clock: systemClock,
    });

    const result = await reorder({
      order: args.order.map((entry) => ({
        catalogCategoryId: toCatalogCategoryId(entry.catalogCategoryId),
        sortOrder: entry.sortOrder,
      })),
    });
    if (result.isErr) throw toConvexError(result.error);
    await stampModerationAction(ctx, {
      actorId: adminId,
      kind: "categories_reordered",
      targetLabel: "Catalog categories",
      targetId: "catalogCategories",
    });
  },
});
