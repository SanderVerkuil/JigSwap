import type { ThreadMessageView } from "@jigswap/contracts";
import { paginationOptsValidator, type PaginationResult } from "convex/server";
import { v } from "convex/values";
import type { Id } from "../_generated/dataModel";
import { query } from "../_generated/server";
import { requireMember } from "../identity/requireMember";
import {
  ownJoinRowsAt,
  readableThreadOf,
  threadMessageViewOf,
} from "./readModelHelpers";

// A thread's messages for the web's infinite scroll, participants only. Convex reactive
// pagination over `by_thread_sent`, NEWEST FIRST (the client reverses for display): the first page
// grows as new messages arrive while later page boundaries stay put. Rows map exactly as in
// getThreadMessages; the Thread aggregate is never hydrated. In a circle thread the range starts
// strictly after the reader's joinedAt, and the last page ends with their own "joined" row.

// A page holds 1 to MAX_PAGE_SIZE messages, whatever the client asks for.
const MAX_PAGE_SIZE = 100;
export const listThreadMessages = query({
  args: { threadId: v.string(), paginationOpts: paginationOptsValidator },
  handler: async (ctx, args): Promise<PaginationResult<ThreadMessageView>> => {
    const me = (await requireMember(ctx)) as unknown as Id<"users">;
    const { thread, floor } = await readableThreadOf(ctx, args.threadId, me);

    const result = await ctx.db
      .query("threadMessages")
      .withIndex("by_thread_sent", (q) => {
        const scoped = q.eq("threadAggregateId", args.threadId);
        return floor === undefined ? scoped : scoped.gt("sentAt", floor);
      })
      .order("desc")
      .paginate({
        ...args.paginationOpts,
        numItems: Math.min(
          MAX_PAGE_SIZE,
          Math.max(1, Math.floor(args.paginationOpts.numItems)),
        ),
      });
    const rows =
      floor !== undefined && result.isDone
        ? [
            ...result.page,
            ...(await ownJoinRowsAt(ctx, args.threadId, me, floor)),
          ]
        : result.page;
    return {
      ...result,
      page: await Promise.all(rows.map(threadMessageViewOf(ctx, me, thread))),
    };
  },
});
