import {
  type Condition,
  makeChangeCopyCondition,
  type OwnerId,
  toCopyId,
} from "@jigswap/domain";
import { v } from "convex/values";
import { mutation } from "../_generated/server";
import { convexCopyManagerPolicy } from "../household/copyAccess";
import { requireMember } from "../identity/requireMember";
import { convexCopyRepository } from "./adapters/convexCopyRepository";
import { libraryEventPublisher } from "./adapters/eventPublisher";
import { systemClock } from "./adapters/systemClock";
import { toConvexError } from "./errors";

// Composition root for re-grading a copy. `copyId` is the domain aggregateId.
export const changeCopyCondition = mutation({
  args: {
    copyId: v.string(),
    condition: v.union(
      v.literal("new_sealed"),
      v.literal("like_new"),
      v.literal("good"),
      v.literal("fair"),
      v.literal("poor"),
    ),
  },
  handler: async (ctx, args) => {
    const actingMemberId = (await requireMember(ctx)) as unknown as OwnerId;

    const change = makeChangeCopyCondition({
      copies: convexCopyRepository(ctx),
      events: libraryEventPublisher(ctx),
      clock: systemClock,
      // Household members with manage permission act as co-owner.
      managers: convexCopyManagerPolicy(ctx),
    });

    const result = await change({
      actingMemberId,
      copyId: toCopyId(args.copyId),
      condition: args.condition as Condition,
    });
    if (result.isErr) throw toConvexError(result.error);
  },
});
