import { makeOpenCircleThread, toCircleId } from "@jigswap/domain";
import { v } from "convex/values";
import { mutation } from "../_generated/server";
import { requireMember } from "../identity/requireMember";
import { enforceRateLimit } from "../lib/rateLimits";
import { convexCircleRoster } from "./adapters/circleRoster";
import { convexThreadRepository } from "./adapters/convexThreadRepository";
import { threadIdGenerator } from "./adapters/idGenerators";
import { toConvexError } from "./errors";

// Composition root for opening (or landing on) a friend circle's group thread. The actor is the
// authenticated member; the use case refuses an unknown circle and a non-member alike with
// CircleNotFound (never "not a member"), and is idempotent per circle: the first open seeds the
// thread from the circle's current members and their join times. Shares the posting rate limit,
// counted only for opens that succeed: a refusal throws, which rolls the counter write back too,
// so it does not bound probing. That is acceptable because circle ids are random UUIDs, and every
// refusal is the same CircleNotFound. Returns the thread's aggregateId.
export const openCircleThread = mutation({
  args: { circleId: v.string() },
  handler: async (ctx, args) => {
    const actorId = await requireMember(ctx);
    await enforceRateLimit(ctx, "messagePost", actorId);

    const open = makeOpenCircleThread({
      threads: convexThreadRepository(ctx),
      threadIds: threadIdGenerator,
      roster: convexCircleRoster(ctx),
    });
    const result = await open({
      circleId: toCircleId(args.circleId),
      actorId,
    });
    if (result.isErr) throw toConvexError(result.error);
    return result.value as string;
  },
});
