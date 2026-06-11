import {
  type CollectionVisibility,
  makeCreateCollection,
  type OwnerId,
} from "@jigswap/domain";
import { v } from "convex/values";
import { mutation } from "../_generated/server";
import { requireMember } from "../identity/requireMember";
import { convexCollectionRepository } from "./adapters/convexCollectionRepository";
import { noopEventPublisher } from "./adapters/eventPublisher";
import { collectionIdGenerator } from "./adapters/idGenerators";
import { systemClock } from "./adapters/systemClock";
import { toConvexError } from "./errors";

// Composition root for creating a collection (or wishlist variant). Enforces (owner, name)
// uniqueness in the use case; returns the new CollectionId (aggregateId).
export const createCollection = mutation({
  args: {
    name: v.string(),
    description: v.optional(v.string()),
    visibility: v.optional(v.union(v.literal("private"), v.literal("public"))),
    color: v.optional(v.string()),
    icon: v.optional(v.string()),
    isWishlist: v.optional(v.boolean()),
    personalNotes: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const ownerId = (await requireMember(ctx)) as unknown as OwnerId;

    const create = makeCreateCollection({
      collections: convexCollectionRepository(ctx),
      ids: collectionIdGenerator,
      events: noopEventPublisher(ctx),
      clock: systemClock,
    });

    const result = await create({
      ownerId,
      name: args.name,
      description: args.description,
      visibility: args.visibility as CollectionVisibility | undefined,
      color: args.color,
      icon: args.icon,
      isWishlist: args.isWishlist,
      personalNotes: args.personalNotes,
    });
    if (result.isErr) throw toConvexError(result.error);
    return result.value as string;
  },
});
