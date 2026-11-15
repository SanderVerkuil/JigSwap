import { makeMarkThreadRead, toThreadId } from "@jigswap/domain";
import { v } from "convex/values";
import type { Id } from "../_generated/dataModel";
import { mutation } from "../_generated/server";
import { requireMember } from "../identity/requireMember";
import { convexThreadRepository } from "./adapters/convexThreadRepository";
import { systemClock } from "./adapters/systemClock";
import { toConvexError } from "./errors";

// Composition root for marking a thread read up to now. Updates only the caller's receipt (the
// aggregate rejects a non-participant) and bell row; no event is recorded for a read.
export const markThreadRead = mutation({
  args: { threadId: v.string() },
  handler: async (ctx, args) => {
    const memberId = await requireMember(ctx);

    const markRead = makeMarkThreadRead({
      threads: convexThreadRepository(ctx),
      clock: systemClock,
    });
    const result = await markRead({
      threadId: toThreadId(args.threadId),
      memberId,
    });
    if (result.isErr) throw toConvexError(result.error);

    // The thread's grouped bell row (see inAppChannel groupOf) is read along with the thread.
    const unread = await ctx.db
      .query("notifications")
      .withIndex("by_user_group", (q) =>
        q
          .eq("userId", memberId as unknown as Id<"users">)
          .eq("groupKey", `thread:${args.threadId}`)
          .eq("isRead", false),
      )
      .collect();
    for (const row of unread) await ctx.db.patch(row._id, { isRead: true });
    return null;
  },
});
