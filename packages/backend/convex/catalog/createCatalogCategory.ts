import { makeCreateCatalogCategory } from "@jigswap/domain";
import { ConvexError, v } from "convex/values";
import type { Id } from "../_generated/dataModel";
import { mutation } from "../_generated/server";
import { stampModerationAction } from "../admin/stampModerationAction";
import { isAdmin } from "../identity/isAdmin";
import { requireMember } from "../identity/requireMember";
import { catalogIdGenerator } from "./adapters/catalogIdGenerator";
import { convexCatalogCategoryRepository } from "./adapters/convexCatalogCategoryRepository";
import { catalogEventPublisher } from "./adapters/eventPublisher";
import { systemClock } from "./adapters/systemClock";
import { toConvexError } from "./errors";

const localized = v.object({ en: v.string(), nl: v.string() });

// Composition root for creating a taxonomy node. The aggregate enforces name completeness
// across every locale. Stamped on the admin audit trail (category_created, SEC-56).
export const createCatalogCategory = mutation({
  args: {
    name: localized,
    sortOrder: v.number(),
    description: v.optional(localized),
    color: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const adminId = (await requireMember(ctx)) as unknown as Id<"users">;
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
    await stampModerationAction(ctx, {
      actorId: adminId,
      kind: "category_created",
      targetLabel: args.name.en,
      targetId: result.value as string,
    });
    return result.value as string;
  },
});
