import { ConversationError } from "@jigswap/domain";
import { ConvexError, v } from "convex/values";
import type { Id } from "../_generated/dataModel";
import { mutation } from "../_generated/server";
import { requireMember } from "../identity/requireMember";
import { toConvexError } from "./errors";
import { participantRowOf, threadRowByAggregateId } from "./readModelHelpers";

// Mute or unmute a thread for the caller only: patches their own participant row and nothing
// else (no thread row write, so no other member's inbox re-runs). A muted thread is left out of
// the shell's unread badge (Q9). Participants only: no thread is ThreadNotFound, anyone without a
// participant row (never in it, or left the circle) is NotParticipant, as for every thread read.
export const setThreadMuted = mutation({
  args: { threadId: v.string(), muted: v.boolean() },
  handler: async (ctx, args) => {
    const me = (await requireMember(ctx)) as unknown as Id<"users">;
    const thread = await threadRowByAggregateId(ctx, args.threadId);
    if (!thread) {
      throw new ConvexError({
        code: "ThreadNotFound",
        message: "Thread not found",
      });
    }
    const row = await participantRowOf(ctx, args.threadId, me);
    if (!row || !thread.participants.includes(me)) {
      throw toConvexError(ConversationError.notParticipant());
    }
    // Unmuting clears the field rather than storing false: absent = not muted.
    await ctx.db.patch(row._id, { muted: args.muted ? true : undefined });
    return null;
  },
});
