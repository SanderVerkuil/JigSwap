import {
  type Condition,
  type CopyId,
  makeChangeCopyCondition,
  type OwnerId,
  toId,
} from "@jigswap/domain";
import { v } from "convex/values";
import { mutation } from "../_generated/server";
import { requireMember } from "../identity/requireMember";
import { convexCopyRepository } from "./adapters/convexCopyRepository";
import { noopEventPublisher } from "./adapters/eventPublisher";
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
      events: noopEventPublisher(ctx),
      clock: systemClock,
    });

    const result = await change({
      actingMemberId,
      copyId: toId<"CopyId">(args.copyId) as CopyId,
      condition: args.condition as Condition,
    });
    if (result.isErr) throw toConvexError(result.error);
  },
});
