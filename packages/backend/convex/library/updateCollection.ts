import {
  type CollectionId,
  type CollectionVisibility,
  makeUpdateCollection,
  type OwnerId,
  toId,
} from "@jigswap/domain";
import { v } from "convex/values";
import { mutation } from "../_generated/server";
import { requireMember } from "../identity/requireMember";
import { convexCollectionRepository } from "./adapters/convexCollectionRepository";
import { noopEventPublisher } from "./adapters/eventPublisher";
import { systemClock } from "./adapters/systemClock";
import { toConvexError } from "./errors";

// Composition root for patching a collection's mutable fields. (owner, name) uniqueness — only
// re-checked when the name changes — lives in the use case. `collectionId` is the aggregateId;
// omitted fields are left unchanged.
export const updateCollection = mutation({
  args: {
    collectionId: v.string(),
    name: v.optional(v.string()),
    description: v.optional(v.string()),
    visibility: v.optional(v.union(v.literal("private"), v.literal("public"))),
    color: v.optional(v.string()),
    icon: v.optional(v.string()),
    personalNotes: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const actingMemberId = (await requireMember(ctx)) as unknown as OwnerId;

    const update = makeUpdateCollection({
      collections: convexCollectionRepository(ctx),
      events: noopEventPublisher(ctx),
      clock: systemClock,
    });

    const result = await update({
      actingMemberId,
      collectionId: toId<"CollectionId">(args.collectionId) as CollectionId,
      name: args.name,
      description: args.description,
      visibility: args.visibility as CollectionVisibility | undefined,
      color: args.color,
      icon: args.icon,
      personalNotes: args.personalNotes,
    });
    if (result.isErr) throw toConvexError(result.error);
  },
});
