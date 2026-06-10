import {
  makeAddCopyToCollection,
  type OwnerId,
  toCollectionId,
  toCopyId,
} from "@jigswap/domain";
import { v } from "convex/values";
import { mutation } from "../_generated/server";
import { requireMember } from "../identity/requireMember";
import { convexCollectionRepository } from "./adapters/convexCollectionRepository";
import { convexCopyRepository } from "./adapters/convexCopyRepository";
import { noopEventPublisher } from "./adapters/eventPublisher";
import { systemClock } from "./adapters/systemClock";
import { toConvexError } from "./errors";

// Composition root for adding a copy to a collection. Ownership (the acting member owns both the
// collection and the copy) is enforced in the use case. Ids are domain aggregateIds.
export const addCopyToCollection = mutation({
  args: {
    collectionId: v.string(),
    copyId: v.string(),
  },
  handler: async (ctx, args) => {
    const actingMemberId = (await requireMember(ctx)) as unknown as OwnerId;

    const add = makeAddCopyToCollection({
      collections: convexCollectionRepository(ctx),
      copies: convexCopyRepository(ctx),
      events: noopEventPublisher(ctx),
      clock: systemClock,
    });

    const result = await add({
      actingMemberId,
      collectionId: toCollectionId(args.collectionId),
      copyId: toCopyId(args.copyId),
    });
    if (result.isErr) throw toConvexError(result.error);
  },
});
