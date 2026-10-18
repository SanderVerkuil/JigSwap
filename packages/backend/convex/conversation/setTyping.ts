import { v } from "convex/values";
import type { Id } from "../_generated/dataModel";
import { mutation } from "../_generated/server";
import { requireMember } from "../identity/requireMember";
import { logEvent } from "../lib/logEvent";
import { isBlockedEitherWay } from "../social/blocks";
import { isAppearingOffline } from "./appearingOffline";
import { readableThreadOf } from "./readModelHelpers";
import {
  TYPING_LOG_SAMPLE_RATE,
  TYPING_THROTTLE_MS,
  typingRowOf,
} from "./typingIndicators";

// "I am typing" in a thread (spec 4.3): upserts the caller's one typing row. Participants only,
// through the same gate as reading the thread (readableThreadOf: ThreadNotFound for no thread,
// NotParticipant otherwise, and in a circle thread a current seat), so it answers a stranger
// exactly what the thread read already does and reveals nothing new.
//
// A silent no-op (no write, the same null) when the caller appears offline (Q13), when the pair of
// an exchange/DM thread is blocked either way (a circle thread hides blocked pairs from each other
// in getTyping instead), or when their row was refreshed under TYPING_THROTTLE_MS ago. It never
// throws for these, so typing can't be used to probe a block or someone's status.
//
// No rate limit: the throttle already caps the writes at one per 2 s per thread and member, and a
// rateLimits row would add a second write to every typing write (spec R.2 Q19 wants them lean).
export const setTyping = mutation({
  args: { threadId: v.string() },
  handler: async (ctx, args): Promise<null> => {
    const me = (await requireMember(ctx)) as unknown as Id<"users">;
    const { thread } = await readableThreadOf(ctx, args.threadId, me);

    if (await isAppearingOffline(ctx, me)) return null;
    if (thread.subjectKind !== "circle") {
      for (const other of thread.participants) {
        if (other !== me && (await isBlockedEitherWay(ctx, me, other))) {
          return null;
        }
      }
    }

    const now = Date.now();
    const row = await typingRowOf(ctx, args.threadId, me);
    if (row && now - row.updatedAt < TYPING_THROTTLE_MS) return null;
    if (row) {
      await ctx.db.patch(row._id, { updatedAt: now });
    } else {
      await ctx.db.insert("typingIndicators", {
        threadAggregateId: args.threadId,
        memberId: me,
        updatedAt: now,
      });
    }

    // Bandwidth counter (spec R.2 Q19), reviewed in Axiom: sampled, so multiply counts by
    // sample_rate. Deliberately no member or thread id: a per-member typing log would be an
    // activity history (spec 5.6).
    if (Math.random() < 1 / TYPING_LOG_SAMPLE_RATE) {
      logEvent({
        event: "conversation.setTyping",
        outcome: "success",
        thread_kind: thread.subjectKind,
        write: row ? "patch" : "insert",
        sample_rate: TYPING_LOG_SAMPLE_RATE,
      });
    }
    return null;
  },
});
