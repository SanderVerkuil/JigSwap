import type { Notification } from "@jigswap/domain";
import { internal } from "../../../_generated/api";
import type { Id } from "../../../_generated/dataModel";
import type { MutationCtx } from "../../../_generated/server";

// Shared Knock-backed channel: resolves the recipient's email/name from the users table and
// schedules the Knock workflow trigger out-of-band. Scheduling (rather than fetching here) keeps
// the delivering mutation transactional and fast; the action runs after commit, so a notification
// is only handed to Knock once it durably exists.
export const knockChannel =
  (ctx: MutationCtx, channel: "email" | "push") =>
  async (notification: Notification): Promise<void> => {
    const state = notification.toState();
    const user = await ctx.db.get(state.userId as unknown as Id<"users">);
    if (!user) return;
    await ctx.scheduler.runAfter(0, internal.notifications.knock.trigger, {
      channel,
      type: state.type as string,
      title: state.title,
      message: state.message,
      relatedId: state.relatedId,
      recipient: {
        id: user.clerkId,
        email: user.email,
        name: user.name,
      },
    });
  };
