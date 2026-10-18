import { makePostMessage, toCopyId, toThreadId } from "@jigswap/domain";
import { ConvexError, v } from "convex/values";
import type { Doc, Id } from "../_generated/dataModel";
import { mutation, type QueryCtx } from "../_generated/server";
import { requireMember } from "../identity/requireMember";
import { enforceRateLimit } from "../lib/rateLimits";
import { canViewCopy } from "../library/canViewCopy";
import { assertThreadNotBlocked } from "../social/blocks";
import { projectMemberIdentity } from "../social/privacy";
import { convexThreadRepository } from "./adapters/convexThreadRepository";
import { messageIdGenerator } from "./adapters/idGenerators";
import { inProcessEventPublisher } from "./adapters/inProcessEventPublisher";
import { systemClock } from "./adapters/systemClock";
import { toConvexError } from "./errors";
import { threadRowByAggregateId } from "./readModelHelpers";

// A copy may be attached to a message in a thread iff it exists, is OWNED by one of the thread's
// participants, and EVERY participant may view it right now (canViewCopy) — so an attachment
// never shows the other side a copy they could not open, and nobody can drop a third party's
// copy into a conversation. Same rule for DM and exchange threads. The OTHER participant's copy is
// also refused while they are anonymous to the author: otherwise success vs CopyNotFound would
// reveal whether the hidden partner owns a copy the author can see (#154).
const isAttachable = async (
  ctx: QueryCtx,
  thread: Doc<"threads">,
  copyId: Id<"ownedPuzzles">,
  authorId: Id<"users">,
): Promise<boolean> => {
  const copy = await ctx.db.get(copyId);
  if (!copy || !thread.participants.includes(copy.ownerId)) return false;
  if (
    copy.ownerId !== authorId &&
    (
      await projectMemberIdentity(
        ctx,
        authorId,
        copy.ownerId,
        thread.aggregateId,
      )
    ).anonymous
  ) {
    return false;
  }
  for (const participant of thread.participants) {
    if (!(await canViewCopy(ctx, participant, copy))) return false;
  }
  return true;
};

// Composition root for posting a member-authored message. The author is always the authenticated
// member; the participant and non-empty-body rules are the aggregate's. `kind` is text ONLY:
// system messages are service-authored, and image messages are refused until attachments ship
// through a server-verified upload path (an image body here would be an arbitrary, unscreened,
// unowned reference). An optional `copyId` attaches a copy (see isAttachable); a copy failing
// that gate is rejected as CopyNotFound, so the error never distinguishes "missing" from "not
// yours / not viewable". The copy gate runs only for a participant of an existing thread; anyone
// else gets the use case's own ThreadNotFound / NotParticipant. Returns the message id.
export const postMessage = mutation({
  args: {
    threadId: v.string(),
    kind: v.literal("text"),
    body: v.string(),
    copyId: v.optional(v.id("ownedPuzzles")),
  },
  handler: async (ctx, args) => {
    const authorId = await requireMember(ctx);
    await enforceRateLimit(ctx, "messagePost", authorId);
    await assertThreadNotBlocked(ctx, args.threadId, authorId);

    if (args.copyId !== undefined) {
      const thread = await threadRowByAggregateId(ctx, args.threadId);
      const isParticipant = thread?.participants.includes(
        authorId as unknown as Id<"users">,
      );
      if (
        thread &&
        isParticipant &&
        !(await isAttachable(
          ctx,
          thread,
          args.copyId,
          authorId as unknown as Id<"users">,
        ))
      ) {
        throw new ConvexError({
          code: "CopyNotFound",
          message: "Copy not found",
        });
      }
    }

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
      copyId:
        args.copyId === undefined ? undefined : toCopyId(args.copyId as string),
    });
    if (result.isErr) throw toConvexError(result.error);
    return result.value as string;
  },
});
