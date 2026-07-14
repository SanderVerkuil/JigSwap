import type { Notification } from "@jigswap/domain";
import { internal } from "../../../_generated/api";
import type { Id } from "../../../_generated/dataModel";
import type { MutationCtx } from "../../../_generated/server";

// Email channel: resolves the recipient's email/name/language and schedules the out-of-band send
// (notifications/sendEmail) after commit. The action renders the localized template — this channel
// only forwards structure (type + params + locale). Scheduling keeps the delivering mutation
// transactional; a mutation rollback also rolls the schedule back, so the notification's
// aggregateId doubles as a safe idempotency key.
export const emailChannel =
  (ctx: MutationCtx) =>
  async (notification: Notification): Promise<void> => {
    const state = notification.toState();
    const user = await ctx.db.get(state.userId as unknown as Id<"users">);
    if (!user) return;
    await ctx.scheduler.runAfter(0, internal.notifications.sendEmail.send, {
      to: user.email,
      toName: user.name,
      type: state.type as string,
      params: (state.params ?? {}) as Record<string, string>,
      locale: user.preferredLanguage === "nl" ? "nl" : "en",
      relatedId: state.relatedId,
      idempotencyKey: state.id as string,
    });
  };
