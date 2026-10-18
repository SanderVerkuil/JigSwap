import type { ThreadMessageView } from "@jigswap/contracts";
import { v } from "convex/values";
import type { Id } from "../_generated/dataModel";
import { query } from "../_generated/server";
import { requireMember } from "../identity/requireMember";
import {
  ownJoinRowsAt,
  readableThreadOf,
  threadMessageViewOf,
} from "./readModelHelpers";

const DEFAULT_PAGE_SIZE = 50;

// One page of a thread's messages, participants only. Cursor semantics: a page is the `limit`
// NEWEST messages strictly older than `before` (all messages when absent), returned ascending by
// sentAt — so the first call yields the latest window and `before = page[0].sentAt` walks older
// history. Pages `by_thread_sent` directly; the Thread aggregate is never hydrated. In a circle
// thread the index range starts strictly after the reader's joinedAt (their history floor), and
// the page that reaches the floor also carries their own "joined" row (ownJoinRowsAt).
export const getThreadMessages = query({
  args: {
    threadId: v.string(),
    before: v.optional(v.number()),
    limit: v.optional(v.number()),
  },
  handler: async (ctx, args): Promise<ThreadMessageView[]> => {
    const me = (await requireMember(ctx)) as unknown as Id<"users">;
    const { thread, floor } = await readableThreadOf(ctx, args.threadId, me);

    const { before } = args;
    const limit = args.limit ?? DEFAULT_PAGE_SIZE;
    const page = await ctx.db
      .query("threadMessages")
      .withIndex("by_thread_sent", (q) => {
        const scoped = q.eq("threadAggregateId", args.threadId);
        if (floor === undefined) {
          return before === undefined ? scoped : scoped.lt("sentAt", before);
        }
        const floored = scoped.gt("sentAt", floor);
        return before === undefined ? floored : floored.lt("sentAt", before);
      })
      .order("desc")
      .take(limit);
    if (
      floor !== undefined &&
      page.length < limit &&
      (before === undefined || floor < before)
    ) {
      page.push(...(await ownJoinRowsAt(ctx, args.threadId, me, floor)));
    }
    return Promise.all(
      page.reverse().map(threadMessageViewOf(ctx, me, thread)),
    );
  },
});
