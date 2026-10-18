import type { Id } from "../_generated/dataModel";
import type { MutationCtx, QueryCtx } from "../_generated/server";
import { findPresencePreferences } from "../social/presencePreferences";
import { TYPING_TTL_MS } from "./typingIndicators";

/**
 * Whether the member chose "Appear offline" (presencePreferences.override === "invisible"): then
 * they emit no typing indicator (spec Q13), and conversation/setTyping is a silent no-op for them.
 */
export const isAppearingOffline = async (
  ctx: QueryCtx,
  memberId: Id<"users">,
): Promise<boolean> =>
  (await findPresencePreferences(ctx, memberId))?.override === "invisible";

/**
 * Stop the member's live typing signals, for a switch to "Appear offline": without this a row
 * written just before the switch would stay visible for up to TYPING_TTL_MS. Only rows written
 * within the TTL can still be live (typingAt ≤ writtenAt), so one bounded index range covers them.
 * The rows are kept (writtenAt unchanged), so the typing throttle is unaffected.
 */
export const stopLiveTypingOf = async (
  ctx: MutationCtx,
  memberId: Id<"users">,
  now: number,
): Promise<void> => {
  const recent = await ctx.db
    .query("typingIndicators")
    .withIndex("by_member", (q) =>
      q.eq("memberId", memberId).gt("writtenAt", now - TYPING_TTL_MS),
    )
    .take(50);
  for (const row of recent) {
    if (row.typingAt !== undefined)
      await ctx.db.patch(row._id, { typingAt: undefined });
  }
};
