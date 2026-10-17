import { resolveMemberDisplayName } from "@jigswap/contracts";
import type { Notification } from "@jigswap/domain";
import { internal } from "../../../_generated/api";
import type { Id } from "../../../_generated/dataModel";
import type { MutationCtx } from "../../../_generated/server";
import { deliveryRefsOf } from "../../deliveryContent";

// Email channel: resolves the recipient's email/name/language and schedules the out-of-band send
// (notifications/sendEmail) after commit. The action resolves the delivery for the recipient (actor,
// live context, deep link) and renders the localized template — this channel only forwards
// structure (type + params + refs + locale). Scheduling keeps the delivering mutation
// transactional; a mutation rollback also rolls the schedule back, so the notification's
// aggregateId doubles as a safe idempotency key.
export const emailChannel =
  (ctx: MutationCtx) =>
  async (notification: Notification): Promise<void> => {
    const state = notification.toState();
    const user = await ctx.db.get(state.userId as unknown as Id<"users">);
    // No verified email on file (see users.updateOrCreateUser): nothing to send to.
    if (!user?.email) return;
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
