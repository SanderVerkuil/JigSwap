import { makeCreateCatalogCategory } from "@jigswap/domain";
import { ConvexError, v } from "convex/values";
import { mutation } from "../_generated/server";
import { isAdmin } from "../identity/isAdmin";
import { requireMember } from "../identity/requireMember";
import { catalogIdGenerator } from "./adapters/catalogIdGenerator";
import { convexCatalogCategoryRepository } from "./adapters/convexCatalogCategoryRepository";
import { catalogEventPublisher } from "./adapters/eventPublisher";
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
    if (!(await isAdmin(ctx))) throw new ConvexError("Forbidden");

    const create = makeCreateCatalogCategory({
      categories: convexCatalogCategoryRepository(ctx),
      ids: catalogIdGenerator,
      events: catalogEventPublisher(ctx),
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
