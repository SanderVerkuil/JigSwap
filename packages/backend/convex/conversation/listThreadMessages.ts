import type { ThreadMessageView } from "@jigswap/contracts";
import { paginationOptsValidator, type PaginationResult } from "convex/server";
import { ConvexError, v } from "convex/values";
import type { Id } from "../_generated/dataModel";
import { query } from "../_generated/server";
import { requireMember } from "../identity/requireMember";
import {
  threadMessageViewOf,
  threadRowByAggregateId,
} from "./readModelHelpers";

// A thread's messages for the web's infinite scroll, participants only. Convex reactive
// pagination over `by_thread_sent`, NEWEST FIRST (the client reverses for display): the first page
// grows as new messages arrive while later page boundaries stay put. Rows map exactly as in
// getThreadMessages; the Thread aggregate is never hydrated.
export const listThreadMessages = query({
  args: { threadId: v.string(), paginationOpts: paginationOptsValidator },
  handler: async (ctx, args): Promise<PaginationResult<ThreadMessageView>> => {
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

    const result = await ctx.db
      .query("threadMessages")
      .withIndex("by_thread_sent", (q) =>
        q.eq("threadAggregateId", args.threadId),
      )
      .order("desc")
      .paginate(args.paginationOpts);
    return {
      ...result,
      page: await Promise.all(result.page.map(threadMessageViewOf(ctx, me))),
    };
  },
});
