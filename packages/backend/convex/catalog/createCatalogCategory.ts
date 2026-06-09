import { makeCreateCatalogCategory } from "@jigswap/domain";
import { v } from "convex/values";
import { mutation } from "../_generated/server";
import { requireMember } from "../identity/requireMember";
import { catalogIdGenerator } from "./adapters/catalogIdGenerator";
import { convexCatalogCategoryRepository } from "./adapters/convexCatalogCategoryRepository";
import { noopEventPublisher } from "./adapters/eventPublisher";
import { systemClock } from "./adapters/systemClock";
import { toConvexError } from "./errors";

const localized = v.object({ en: v.string(), nl: v.string() });

// Composition root for creating a taxonomy node. The aggregate enforces name completeness
// across every locale.
export const createCatalogCategory = mutation({
  args: {
    name: localized,
    sortOrder: v.number(),
    description: v.optional(localized),
    color: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    await requireMember(ctx);

    const create = makeCreateCatalogCategory({
      categories: convexCatalogCategoryRepository(ctx),
      ids: catalogIdGenerator,
      events: noopEventPublisher(),
      clock: systemClock,
    });

    const result = await create({
      name: args.name,
      sortOrder: args.sortOrder,
      description: args.description,
      color: args.color,
    });
    if (result.isErr) throw toConvexError(result.error);
    return result.value as string;
  },
});
