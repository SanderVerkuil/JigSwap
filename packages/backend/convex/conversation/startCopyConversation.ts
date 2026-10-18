import {
  makeOpenDmThread,
  makePostMessage,
  toCopyId,
  toMemberId,
} from "@jigswap/domain";
import { ConvexError, v } from "convex/values";
import type { Id } from "../_generated/dataModel";
import { mutation } from "../_generated/server";
import { requireMember } from "../identity/requireMember";
import { enforceRateLimit } from "../lib/rateLimits";
import { canViewCopy } from "../library/canViewCopy";
import { assertPairNotBlocked } from "../social/blocks";
import { convexConnectionPolicy } from "./adapters/connectionPolicy";
import { convexThreadRepository } from "./adapters/convexThreadRepository";
import { messageIdGenerator, threadIdGenerator } from "./adapters/idGenerators";
import { inProcessEventPublisher } from "./adapters/inProcessEventPublisher";
import { systemClock } from "./adapters/systemClock";
import { toConvexError } from "./errors";

// Composition root for the first message of a conversation about a copy: open (or land on) the
// DM with the copy's owner and post the message referencing the copy, in ONE transaction — so a
// rejected first message (empty, too long) rolls the freshly opened thread back and no empty
// thread is ever left behind. Gates, in order: authenticated member; the messagePost rate limit
// (shared with postMessage); the copy exists and the caller may view it (CopyNotFound, no
// existence leak); the pair isn't blocked either way (NotConnected); then the use cases' own rules — not
// yourself (DmRequiresTwoParticipants), the ConnectionPolicy (NotConnected), one DM per pair.
// The recipient is derived from the copy, never client-supplied. Returns the thread's id.
export const startCopyConversation = mutation({
  args: { copyId: v.id("ownedPuzzles"), body: v.string() },
  handler: async (ctx, args) => {
    const me = await requireMember(ctx);
    await enforceRateLimit(ctx, "messagePost", me);

    const copy = await ctx.db.get(args.copyId);
    if (
      !copy ||
      !(await canViewCopy(ctx, me as unknown as Id<"users">, copy))
    ) {
      throw new ConvexError({
        code: "CopyNotFound",
        message: "Copy not found",
      });
    }

    await assertPairNotBlocked(ctx, me, copy.ownerId);

    const threads = convexThreadRepository(ctx);
    const opened = await makeOpenDmThread({
      threads,
      threadIds: threadIdGenerator,
      connections: convexConnectionPolicy(ctx),
    })({ initiatorId: me, recipientId: toMemberId(copy.ownerId as string) });
    if (opened.isErr) throw toConvexError(opened.error);

    const posted = await makePostMessage({
      threads,
      messageIds: messageIdGenerator,
      events: inProcessEventPublisher(ctx),
      clock: systemClock,
    })({
      threadId: opened.value,
      authorId: me,
      kind: "text",
      body: args.body,
      copyId: toCopyId(copy._id as string),
    });
    if (posted.isErr) throw toConvexError(posted.error);

    return opened.value as string;
  },
});
