import { ConvexError, v } from "convex/values";
import type { Id } from "../_generated/dataModel";
import { query } from "../_generated/server";
import { requireMember } from "../identity/requireMember";

// The thread anchored to an exchange, for a participant: its aggregateId, or null while the
// (subscriber-opened) thread doesn't exist yet. Non-participants are rejected so the lookup
// leaks nothing about other members' exchanges.
export const getThreadByExchange = query({
  args: { exchangeId: v.string() },
  handler: async (ctx, args): Promise<string | null> => {
    const me = (await requireMember(ctx)) as unknown as Id<"users">;

    // Resolve the real `exchanges._id` from the Exchange aggregateId; exchanges that predate
    // aggregateId fall back to treating the value as a raw `_id` (mirrors the repository).
    const byAggregateId = await ctx.db
      .query("exchanges")
      .withIndex("by_aggregate_id", (q) => q.eq("aggregateId", args.exchangeId))
      .unique();
    const exchangeDocId = byAggregateId
      ? byAggregateId._id
      : (args.exchangeId as Id<"exchanges">);

    const thread = await ctx.db
      .query("threads")
      .withIndex("by_exchange", (q) => q.eq("exchangeId", exchangeDocId))
      .unique();
    if (!thread) return null;
    if (!thread.participants.includes(me)) {
      throw new ConvexError({
        code: "NotParticipant",
        message: "Only participants may read a thread",
      });
    }
    return thread.aggregateId;
  },
});
