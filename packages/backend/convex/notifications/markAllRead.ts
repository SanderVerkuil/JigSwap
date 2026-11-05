import { makeMarkAllRead, toMemberId, type MemberId } from "@jigswap/domain";
import { v } from "convex/values";
import { internal } from "../_generated/api";
import type { Id } from "../_generated/dataModel";
import {
  internalMutation,
  mutation,
  type MutationCtx,
} from "../_generated/server";
import { requireMember } from "../identity/requireMember";
import { convexNotificationRepository } from "./adapters/convexNotificationRepository";
import { systemClock } from "./adapters/systemClock";

// Notification's own events are leaf events (no downstream subscriber); drop them.
const noopEvents = { async publish(): Promise<void> {} };

// Mark one batch of the member's unread notifications read (the repository caps a call at
// MARK_ALL_READ_BATCH) and, while unread rows remain, schedule the next batch right away. Every row
// a batch reads ends up read, so each continuation makes progress and the chain ends. Returns how
// many domain notifications this batch marked.
const markBatchAndContinue = async (
  ctx: MutationCtx,
  memberId: MemberId,
): Promise<number> => {
  const markAll = makeMarkAllRead({
    notifications: convexNotificationRepository(ctx),
    events: noopEvents,
    clock: systemClock,
  });
  const result = await markAll({ memberId });

  const userId = memberId as unknown as Id<"users">;
  const stillUnread = await ctx.db
    .query("notifications")
    .withIndex("by_user_read", (q) =>
      q.eq("userId", userId).eq("isRead", false),
    )
    .first();
  if (stillUnread !== null) {
    await ctx.scheduler.runAfter(
      0,
      internal.notifications.markAllRead.markRemainingRead,
      { memberId: userId },
    );
  }
  // makeMarkAllRead never errors (Result<number, never>).
  return result.isErr ? 0 : result.value;
};

// Mark every unread notification for the caller as read. The member is resolved from auth; the
// repository scan is scoped to them, so no per-row ownership check is needed. Returns the count
// marked in this call (one batch); a larger backlog finishes in markRemainingRead moments later.
export const markAllRead = mutation({
  args: {},
  handler: async (ctx) => {
    const memberId = await requireMember(ctx);
    return markBatchAndContinue(ctx, memberId);
  },
});

// Continuation of markAllRead past the first batch. Internal: only markAllRead schedules it, with the
// member it resolved from auth.
export const markRemainingRead = internalMutation({
  args: { memberId: v.id("users") },
  handler: async (ctx, { memberId }) => {
    await markBatchAndContinue(ctx, toMemberId(memberId));
  },
});
