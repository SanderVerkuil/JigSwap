import { makeOpenDmThread, toMemberId } from "@jigswap/domain";
import { v } from "convex/values";
import { mutation } from "../_generated/server";
import { requireMember } from "../identity/requireMember";
import { convexConnectionPolicy } from "./adapters/connectionPolicy";
import { convexThreadRepository } from "./adapters/convexThreadRepository";
import { threadIdGenerator } from "./adapters/idGenerators";
import { toConvexError } from "./errors";

// Composition root for opening (or landing on) the DM thread between the caller and a recipient.
// The initiator is always the authenticated member; the connection gate and the one-DM-per-pair
// idempotency both live in the use case. Returns the thread's aggregateId (existing or new).
export const openDmThread = mutation({
  args: { recipientId: v.string() },
  handler: async (ctx, args) => {
    const initiatorId = await requireMember(ctx);

    const openDm = makeOpenDmThread({
      threads: convexThreadRepository(ctx),
      threadIds: threadIdGenerator,
      connections: convexConnectionPolicy(ctx),
    });
    const result = await openDm({
      initiatorId,
      recipientId: toMemberId(args.recipientId),
    });
    if (result.isErr) throw toConvexError(result.error);
    return result.value as string;
  },
});
