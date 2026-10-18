import { v } from "convex/values";
import type { Id } from "../_generated/dataModel";
import { mutation } from "../_generated/server";
import { requireMember } from "../identity/requireMember";
import { clearTypingOf } from "./typingIndicators";

// "I stopped typing" (spec 4.3): deletes the caller's own typing row in the thread, if any, and
// nothing else. No participant gate: it can only ever touch the caller's own row, answers the same
// null whether or not a row or the thread exists, and so lets a member who just left a circle
// still clear theirs. Sending clears it too (postMessage and the media sends).
export const clearTyping = mutation({
  args: { threadId: v.string() },
  handler: async (ctx, args): Promise<null> => {
    const me = (await requireMember(ctx)) as unknown as Id<"users">;
    await clearTypingOf(ctx, args.threadId, me);
    return null;
  },
});
