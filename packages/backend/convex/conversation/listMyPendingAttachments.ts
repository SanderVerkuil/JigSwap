import type { PendingAttachmentView } from "@jigswap/contracts";
import { v } from "convex/values";
import type { Id } from "../_generated/dataModel";
import { query } from "../_generated/server";
import { requireMember } from "../identity/requireMember";
import {
  participantThreadOf,
  pendingAttachmentViewOf,
} from "./messageAttachments";

// The caller's outbox for one thread (spec 2.2): their own photos that are not messages (yet),
// staged or sent, oldest first. Only ever the caller's own rows; see pendingAttachmentViewOf for
// what each state shows (a quarantined photo looks exactly like a flagged one).
export const listMyPendingAttachments = query({
  args: { threadId: v.string() },
  handler: async (ctx, { threadId }): Promise<PendingAttachmentView[]> => {
    const me = (await requireMember(ctx)) as unknown as Id<"users">;
    await participantThreadOf(ctx, threadId, me);
    const rows = await ctx.db
      .query("messageAttachments")
      .withIndex("by_thread_uploader", (q) =>
        q.eq("threadAggregateId", threadId).eq("uploaderId", me),
      )
      .collect();
    return Promise.all(
      rows
        .filter((row) => row.messageId === undefined && !row.hiddenFromSender)
        .sort((a, b) => a.createdAt - b.createdAt)
        .map((row) => pendingAttachmentViewOf(ctx, row)),
    );
  },
});
