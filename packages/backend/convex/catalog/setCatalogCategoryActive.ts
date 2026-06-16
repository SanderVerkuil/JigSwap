import {
  makeSetCatalogCategoryActive,
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

// Composition root for the soft (de)activation toggle — a node is never deleted, only hidden.
// The aggregate makes the toggle idempotent (no event when unchanged).
export const setCatalogCategoryActive = mutation({
  args: { catalogCategoryId: v.string(), isActive: v.boolean() },
  handler: async (ctx, args) => {
    await requireMember(ctx);
    if (!(await isAdmin(ctx))) throw new ConvexError("Forbidden");

    const setActive = makeSetCatalogCategoryActive({
      categories: convexCatalogCategoryRepository(ctx),
      events: noopEventPublisher(ctx),
      clock: systemClock,
    });

    const result = await setActive({
      catalogCategoryId: toCatalogCategoryId(args.catalogCategoryId),
      isActive: args.isActive,
    });
    if (result.isErr) throw toConvexError(result.error);
  },
});
