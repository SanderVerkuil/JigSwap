import { v } from "convex/values";
import type { Id } from "../_generated/dataModel";
import { mutation } from "../_generated/server";
import { requireMember } from "../identity/requireMember";
import { isTypingAt, logTypingWrite, typingRowOf } from "./typingIndicators";

// "I stopped typing" (spec 4.3): unsets `typingAt` on the caller's own typing row and nothing
// else. It KEEPS the row and stamps `writtenAt`, so a stop counts against setTyping's throttle: a
// set/clear loop can't write more than twice per TYPING_THROTTLE_MS. A no-op (no write) unless the
// row currently says "is typing", so repeated clears cost nothing. No participant gate: it can
// only ever touch the caller's own row and answers the same null whether or not a row or the
// thread exists, so a member who just left a circle can still clear theirs. Sending deletes the
// row (postMessage and the media sends).
export const clearTyping = mutation({
  args: { threadId: v.string() },
  handler: async (ctx, args): Promise<null> => {
    const me = (await requireMember(ctx)) as unknown as Id<"users">;
    const now = Date.now();
    const row = await typingRowOf(ctx, args.threadId, me);
    if (!row || !isTypingAt(row, now)) return null;
    await ctx.db.patch(row._id, { typingAt: undefined, writtenAt: now });
    // No thread kind on a clear's line: reading the thread just for the log isn't worth it.
    logTypingWrite("clear");
    return null;
  },
});
