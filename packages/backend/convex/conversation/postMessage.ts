import { makePostMessage, toThreadId } from "@jigswap/domain";
import { v } from "convex/values";
import { mutation } from "../_generated/server";
import { requireMember } from "../identity/requireMember";
import { convexThreadRepository } from "./adapters/convexThreadRepository";
import { messageIdGenerator } from "./adapters/idGenerators";
import { inProcessEventPublisher } from "./adapters/inProcessEventPublisher";
import { systemClock } from "./adapters/systemClock";
import { toConvexError } from "./errors";

// Composition root for posting a member-authored message. The author is always the authenticated
// member; the participant and non-empty-body rules are the aggregate's. `kind` is text or image
// only — system messages are service-authored and have no transport here. Returns the message id.
export const postMessage = mutation({
  args: {
    threadId: v.string(),
    kind: v.union(v.literal("text"), v.literal("image")),
    body: v.string(),
  },
  handler: async (ctx, args) => {
    const authorId = await requireMember(ctx);

    const post = makePostMessage({
      threads: convexThreadRepository(ctx),
      messageIds: messageIdGenerator,
      events: inProcessEventPublisher(ctx),
      clock: systemClock,
    });
    const result = await post({
      threadId: toThreadId(args.threadId),
      authorId,
      kind: args.kind,
      body: args.body,
    });
    if (result.isErr) throw toConvexError(result.error);
    return result.value as string;
  },
});
