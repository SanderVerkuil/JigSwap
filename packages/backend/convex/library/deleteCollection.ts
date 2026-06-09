import {
  type CollectionId,
  makeDeleteCollection,
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

// Composition root for deleting a collection. The default-collection guard lives in the
// aggregate. `collectionId` is the domain aggregateId.
export const deleteCollection = mutation({
  args: { collectionId: v.string() },
  handler: async (ctx, args) => {
    const actingMemberId = (await requireMember(ctx)) as unknown as OwnerId;

    const remove = makeDeleteCollection({
      collections: convexCollectionRepository(ctx),
      events: noopEventPublisher(),
      clock: systemClock,
    });

    const result = await remove({
      actingMemberId,
      collectionId: toId<"CollectionId">(args.collectionId) as CollectionId,
    });
    if (result.isErr) throw toConvexError(result.error);
  },
});
