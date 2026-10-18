import {
  Notification,
  toMemberId,
  toNotificationId,
  type MemberId,
} from "@jigswap/domain";
import { v } from "convex/values";
import { internal } from "../_generated/api";
import type { Id } from "../_generated/dataModel";
import { internalMutation, type MutationCtx } from "../_generated/server";
import { participantRowOf } from "../conversation/readModelHelpers";
import { isCurrentCircleMember } from "../conversation/threadMemberProjection";
import {
  DIGEST_ID_PREFIX,
  emailChannel,
} from "./adapters/channels/emailChannel";
import { convexNotificationPreferenceRepository } from "./adapters/convexNotificationPreferenceRepository";
import { isViewingMessages } from "./presenceGate";

// The circle thread email digest (spec 5.5). A circle message is never emailed on its own: the
// first unread one since the member last read the thread arms a single delayed digest, which at
// fire time sends one email only if the member still hasn't caught up. DMs and exchange threads
// keep their per-message email.

/** How long after the first unread message the digest fires. */
export const DIGEST_DELAY_MS = 30 * 60 * 1000;
/** At most one digest per thread per member in this window. */
export const DIGEST_COOLDOWN_MS = 6 * 60 * 60 * 1000;

const TYPE = "circle_message_received" as const;

const emailEnabled = async (
  ctx: MutationCtx,
  memberId: Id<"users">,
): Promise<boolean> => {
  const preference = await convexNotificationPreferenceRepository(
    ctx,
  ).findByMember(toMemberId(memberId as unknown as string));
  // No stored preference: the default, which keeps circle email off.
  return preference?.allows(TYPE, "email") ?? false;
};

/**
 * Arm the digest for one member after a circle message notified them. A no-op when their circle
 * email is off, a digest is already pending, they were already emailed about this unread run (no
 * read since), or they had one within the cooldown.
 */
export const armThreadDigest = async (
  ctx: MutationCtx,
  threadId: string,
  memberId: MemberId,
): Promise<void> => {
  const userId = memberId as unknown as Id<"users">;
  const seat = await participantRowOf(ctx, threadId, userId);
  if (!seat || seat.muted === true) return;
  const now = Date.now();
  if (seat.emailPendingUntil !== undefined && seat.emailPendingUntil > now) {
    return;
  }
  if (seat.lastEmailedAt !== undefined) {
    if (seat.lastEmailedAt > (seat.lastReadAt ?? 0)) return;
    if (now - seat.lastEmailedAt < DIGEST_COOLDOWN_MS) return;
  }
  if (!(await emailEnabled(ctx, userId))) return;
  await ctx.db.patch(seat._id, { emailPendingUntil: now + DIGEST_DELAY_MS });
  await ctx.scheduler.runAfter(
    DIGEST_DELAY_MS,
    internal.notifications.threadDigest.maybeEmailThreadDigest,
    { threadId, memberId: userId },
  );
};

/**
 * Fire the digest: one email when the member is still a participant of the circle thread, hasn't
 * muted it, still has unread messages in it (past their joinedAt floor), isn't on /messages right
 * now, still wants circle email, and had no digest for it in the last 6 h. Otherwise nothing.
 */
export const maybeEmailThreadDigest = internalMutation({
  args: { threadId: v.string(), memberId: v.id("users") },
  handler: async (ctx, { threadId, memberId }) => {
    const seat = await participantRowOf(ctx, threadId, memberId);
    if (!seat) return;
    await ctx.db.patch(seat._id, { emailPendingUntil: undefined });

    const thread = await ctx.db
      .query("threads")
      .withIndex("by_aggregate_id", (q) => q.eq("aggregateId", threadId))
      .unique();
    if (
      !thread ||
      thread.subjectKind !== "circle" ||
      thread.circleId === undefined ||
      !thread.participants.includes(memberId) ||
      !(await isCurrentCircleMember(ctx, thread.circleId, memberId))
    ) {
      return;
    }
    const now = Date.now();
    if (
      seat.muted === true ||
      (seat.unreadCount ?? 0) === 0 ||
      (seat.lastEmailedAt !== undefined &&
        now - seat.lastEmailedAt < DIGEST_COOLDOWN_MS) ||
      (await isViewingMessages(ctx, memberId as string)) ||
      !(await emailEnabled(ctx, memberId))
    ) {
      return;
    }

    await ctx.db.patch(seat._id, { lastEmailedAt: now });
    // The ordinary email path: the send action resolves the thread for the member (its circle's
    // live name, nothing if they are no longer in it) and renders the digest template. No actor:
    // the digest names no author.
    await emailChannel(ctx)(
      Notification.rehydrate({
        id: toNotificationId(
          `${DIGEST_ID_PREFIX}${threadId}:${memberId}:${now}`,
        ),
        userId: toMemberId(memberId as unknown as string),
        type: TYPE,
        params: {},
        relatedId: threadId,
        subject: { kind: "thread", threadId },
        channel: "email",
        isRead: false,
        createdAt: new Date(now),
      }),
    );
  },
});
