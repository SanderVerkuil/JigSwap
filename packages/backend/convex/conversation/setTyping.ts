import { v } from "convex/values";
import type { Id } from "../_generated/dataModel";
import { mutation } from "../_generated/server";
import { requireMember } from "../identity/requireMember";
import { isBlockedEitherWay } from "../social/blocks";
import { isAppearingOffline } from "./appearingOffline";
import { readableThreadOf } from "./readModelHelpers";
import {
  logTypingWrite,
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
// in getTyping instead), or when ANY of their typing rows, in any thread, was written (set or
// cleared) under TYPING_THROTTLE_MS ago: one write per 2 s per member, whatever the number of
// threads. It never throws for these, so typing can't be used to probe a block or someone's status.
//
// No rateLimits row: the throttle already caps the writes at one per 2 s per member with a single
// indexed read, and a counter would add a second write to every typing write (R.2 Q19).
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
    // The member's latest write in any thread (this one included) under the throttle.
    const recentWrite = await ctx.db
      .query("typingIndicators")
      .withIndex("by_member", (q) =>
        q.eq("memberId", me).gt("writtenAt", now - TYPING_THROTTLE_MS),
      )
      .first();
    if (recentWrite) return null;
    const row = await typingRowOf(ctx, args.threadId, me);
    if (row) {
      await ctx.db.patch(row._id, { typingAt: now, writtenAt: now });
    } else {
      await ctx.db.insert("typingIndicators", {
        threadAggregateId: args.threadId,
        memberId: me,
        typingAt: now,
        writtenAt: now,
      });
    }
    logTypingWrite(row ? "patch" : "insert", thread.subjectKind);
    return null;
  },
});
