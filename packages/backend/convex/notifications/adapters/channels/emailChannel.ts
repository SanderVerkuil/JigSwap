import { resolveMemberDisplayName } from "@jigswap/contracts";
import type { Notification } from "@jigswap/domain";
import { internal } from "../../../_generated/api";
import type { Id } from "../../../_generated/dataModel";
import type { MutationCtx } from "../../../_generated/server";
import { participantRowOf } from "../../../conversation/readModelHelpers";
import { consumeRateLimit } from "../../../lib/rateLimits";
import { deliveryRefsOf } from "../../deliveryContent";
import { followNoticeAllowed } from "./followNoticeThrottle";

// Email channel: resolves the recipient's email/name/language and schedules the out-of-band send
// (notifications/sendEmail) after commit. The action resolves the delivery for the recipient (actor,
// live context, deep link) and renders the localized template — this channel only forwards
// structure (type + params + refs + locale). Scheduling keeps the delivering mutation
// transactional; a mutation rollback also rolls the schedule back, so the notification's
// aggregateId doubles as a safe idempotency key.
//
// Two brakes sit in front of the send (SEC-25). A DM or exchange message (message_received) is
// emailed once per unread run: the first message after the member last read the thread emails
// them, and later ones wait until they have read it again (the thread's participant row keeps
// lastEmailedAt; the circle digest applies the same rule to its own threads). And no member is
// sent more than RATE_LIMITS.emailDaily notification emails a day, whatever the type; past it the
// email is dropped and the refusal logged (the in-app row is unaffected). Follow notices are
// emailed at most once a day per actor and type (followNoticeThrottle, SEC-23).

// The id prefix of a circle thread digest (notifications/threadDigest). A circle message is only
// ever emailed as that digest: any other circle_message_received delivery is refused here, so a
// caller that forgets to narrow its channels can never send one email per message.
export const DIGEST_ID_PREFIX = "digest:";

export const emailChannel =
  (ctx: MutationCtx) =>
  async (notification: Notification): Promise<void> => {
    const state = notification.toState();
    if (
      state.type === "circle_message_received" &&
      !(state.id as string).startsWith(DIGEST_ID_PREFIX)
    ) {
      return;
    }
    const user = await ctx.db.get(state.userId as unknown as Id<"users">);
    // No verified email on file (see users.updateOrCreateUser): nothing to send to.
    if (!user?.email) return;
    const seat =
      state.type === "message_received" && state.subject?.kind === "thread"
        ? await participantRowOf(ctx, state.subject.threadId, user._id)
        : null;
    if (
      seat?.lastEmailedAt !== undefined &&
      seat.lastEmailedAt > (seat.lastReadAt ?? 0)
    ) {
      return;
    }
    if (!(await followNoticeAllowed(ctx, "email", state))) return;
    if (!(await consumeRateLimit(ctx, "emailDaily", user._id))) return;
    if (seat) {
      await ctx.db.patch(seat._id, {
        lastEmailedAt: state.createdAt.getTime(),
      });
    }
    await ctx.scheduler.runAfter(0, internal.notifications.sendEmail.send, {
      to: user.email,
      // The recipient's OWN label, so their email is a fine fallback.
      toName:
        resolveMemberDisplayName({
          name: user.name,
          email: user.email,
          username: user.username,
        })?.text ?? user.email,
      type: state.type as string,
      params: (state.params ?? {}) as Record<string, string>,
      locale: user.preferredLanguage === "nl" ? "nl" : "en",
      relatedId: state.relatedId,
      idempotencyKey: state.id as string,
      userId: user._id,
      ...deliveryRefsOf(state),
    });
  };
