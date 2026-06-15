import type { Notification } from "@jigswap/domain";
import { internal } from "../../../_generated/api";
import type { Id } from "../../../_generated/dataModel";
import type { MutationCtx } from "../../../_generated/server";

// Email channel: resolves the recipient's email/name and schedules the out-of-band send
// (notifications/sendEmail) after commit. The configured EmailSender is currently a no-op (Knock
// removed, no provider chosen yet), so this drops with a log until a provider is wired into
// makeEmailSenderFromEnv. Scheduling keeps the delivering mutation transactional; opting into email
// never creates in-app rows — only inAppChannel persists.
export const emailChannel =
  (ctx: MutationCtx) =>
  async (notification: Notification): Promise<void> => {
    const state = notification.toState();
    const user = await ctx.db.get(state.userId as unknown as Id<"users">);
    if (!user) return;
    await ctx.scheduler.runAfter(0, internal.notifications.sendEmail.send, {
      to: user.email,
      toName: user.name,
      subject: state.title,
      body: state.message,
      type: state.type as string,
      relatedId: state.relatedId,
    });
  };
