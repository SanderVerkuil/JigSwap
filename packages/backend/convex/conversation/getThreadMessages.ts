import type { ThreadMessageView } from "@jigswap/contracts";
import { ConvexError, v } from "convex/values";
import type { Id } from "../_generated/dataModel";
import { query } from "../_generated/server";
import { requireMember } from "../identity/requireMember";
import {
  threadRowByAggregateId,
  toThreadMessageView,
} from "./readModelHelpers";

const DEFAULT_PAGE_SIZE = 50;

// One page of a thread's messages, participants only. Cursor semantics: a page is the `limit`
// NEWEST messages strictly older than `before` (all messages when absent), returned ascending by
// sentAt — so the first call yields the latest window and `before = page[0].sentAt` walks older
// history. Pages `by_thread_sent` directly; the Thread aggregate is never hydrated.
export const getThreadMessages = query({
  args: {
    threadId: v.string(),
    before: v.optional(v.number()),
    limit: v.optional(v.number()),
  },
  handler: async (ctx, args): Promise<ThreadMessageView[]> => {
    const me = (await requireMember(ctx)) as unknown as Id<"users">;
    const thread = await threadRowByAggregateId(ctx, args.threadId);
    if (!thread) {
      throw new ConvexError({
        code: "ThreadNotFound",
        message: "Thread not found",
      });
    }
    if (!thread.participants.includes(me)) {
      throw new ConvexError({
        code: "NotParticipant",
        message: "Only participants may read a thread",
      });
    }

    const before = args.before;
    const page = await ctx.db
      .query("threadMessages")
      .withIndex("by_thread_sent", (q) => {
        const scoped = q.eq("threadAggregateId", args.threadId);
        return before === undefined ? scoped : scoped.lt("sentAt", before);
      })
      .order("desc")
      .take(args.limit ?? DEFAULT_PAGE_SIZE);
    return page.reverse().map(toThreadMessageView);
  },
});
