import {
  type CatalogCategoryId,
  makeReorderCatalogCategories,
  toId,
} from "@jigswap/domain";
import { v } from "convex/values";
import { mutation } from "../_generated/server";
import { requireMember } from "../identity/requireMember";
import { convexCatalogCategoryRepository } from "./adapters/convexCatalogCategoryRepository";
import { noopEventPublisher } from "./adapters/eventPublisher";
import { systemClock } from "./adapters/systemClock";
import { toConvexError } from "./errors";

// Composition root for reordering several taxonomy nodes at once. The use case loads every
// targeted node first (any missing => CatalogCategoryNotFound, before any write).
export const reorderCatalogCategories = mutation({
  args: {
    order: v.array(
      v.object({ catalogCategoryId: v.string(), sortOrder: v.number() }),
    ),
  },
  handler: async (ctx, args) => {
    await requireMember(ctx);

    const reorder = makeReorderCatalogCategories({
      categories: convexCatalogCategoryRepository(ctx),
      events: noopEventPublisher(ctx),
      clock: systemClock,
    });

    const result = await reorder({
      order: args.order.map((entry) => ({
        catalogCategoryId: toId<"CatalogCategoryId">(
          entry.catalogCategoryId,
        ) as CatalogCategoryId,
        sortOrder: entry.sortOrder,
      })),
    });
    if (result.isErr) throw toConvexError(result.error);
  },
});
