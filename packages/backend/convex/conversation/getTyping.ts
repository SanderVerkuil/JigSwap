import type { TypingView } from "@jigswap/contracts";
import { v } from "convex/values";
import type { Id } from "../_generated/dataModel";
import { query } from "../_generated/server";
import { requireMember } from "../identity/requireMember";
import { blockedEitherWaySet } from "../social/blocks";
import { readableThreadOf } from "./readModelHelpers";
import { threadMemberProjector } from "./threadMemberProjection";
import { isTypingAt, MAX_TYPING_ROWS } from "./typingIndicators";

// Who else is typing in a thread (spec 4.3, 5.2), participants only (readableThreadOf, as for
// reading its messages). Rows whose `typingAt` is under TYPING_TTL_MS old, never the viewer's own and never
// a member blocked either way with the viewer (in a circle thread too: typing never crosses a
// block, spec 5.3). Each typer is projected for the viewer (projectThreadMember) and carries
// `ageMs`, measured here; the client expires entries on its own timer from that, so no scheduled
// delete or clock comparison is needed. One by_thread read of at most MAX_TYPING_ROWS rows; the
// block sets are read only when someone else is typing.
export const getTyping = query({
  args: { threadId: v.string() },
  handler: async (ctx, args): Promise<TypingView[]> => {
    const me = (await requireMember(ctx)) as unknown as Id<"users">;
    const { thread } = await readableThreadOf(ctx, args.threadId, me);

    const now = Date.now();
    const fresh = (
      await ctx.db
        .query("typingIndicators")
        .withIndex("by_thread", (q) => q.eq("threadAggregateId", args.threadId))
        .take(MAX_TYPING_ROWS)
    )
      .filter((row) => row.memberId !== me)
      .filter((row) => isTypingAt(row, now));
    if (fresh.length === 0) return [];

    const blocked = await blockedEitherWaySet(ctx, me);
    const project = threadMemberProjector(ctx, me, thread);
    return Promise.all(
      fresh
        .filter((row) => !blocked.has(row.memberId))
        .map(async (row) => ({
          member: await project(row.memberId),
          ageMs: now - row.typingAt,
        })),
    );
  },
});
