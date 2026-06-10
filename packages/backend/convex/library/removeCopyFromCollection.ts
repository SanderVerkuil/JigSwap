import {
  makeRemoveCopyFromCollection,
  type OwnerId,
  toCollectionId,
  toCopyId,
} from "@jigswap/domain";
import { v } from "convex/values";
import { mutation } from "../_generated/server";
import { requireMember } from "../identity/requireMember";
import { convexCollectionRepository } from "./adapters/convexCollectionRepository";
import { noopEventPublisher } from "./adapters/eventPublisher";
import { systemClock } from "./adapters/systemClock";
import { toConvexError } from "./errors";

// Composition root for removing a copy from a collection. Ids are domain aggregateIds.
export const removeCopyFromCollection = mutation({
  args: {
    collectionId: v.string(),
    copyId: v.string(),
  },
  handler: async (ctx, args) => {
    const actingMemberId = (await requireMember(ctx)) as unknown as OwnerId;

    const remove = makeRemoveCopyFromCollection({
      collections: convexCollectionRepository(ctx),
      events: noopEventPublisher(ctx),
      clock: systemClock,
    });

    const result = await remove({
      actingMemberId,
      collectionId: toCollectionId(args.collectionId),
      copyId: toCopyId(args.copyId),
    });
    if (result.isErr) throw toConvexError(result.error);
  },
});
