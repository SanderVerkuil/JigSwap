import {
  makeUpdateCatalogCategory,
  toCatalogCategoryId,
} from "@jigswap/domain";
import { ConvexError, v } from "convex/values";
import { mutation } from "../_generated/server";
import { isAdmin } from "../identity/isAdmin";
import { requireMember } from "../identity/requireMember";
import { convexCatalogCategoryRepository } from "./adapters/convexCatalogCategoryRepository";
import { noopEventPublisher } from "./adapters/eventPublisher";
import { systemClock } from "./adapters/systemClock";
import { toConvexError } from "./errors";

const localized = v.object({ en: v.string(), nl: v.string() });

// Composition root for patching a node's presentation fields. A replacement name must stay
// complete in every locale (enforced by the aggregate).
export const updateCatalogCategory = mutation({
  args: {
    catalogCategoryId: v.string(),
    name: v.optional(localized),
    description: v.optional(localized),
    color: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    await requireMember(ctx);
    if (!(await isAdmin(ctx))) throw new ConvexError("Forbidden");

    const update = makeUpdateCatalogCategory({
      categories: convexCatalogCategoryRepository(ctx),
      events: noopEventPublisher(ctx),
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
  },
});
