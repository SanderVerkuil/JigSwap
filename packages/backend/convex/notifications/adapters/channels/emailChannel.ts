import type { Notification } from "@jigswap/domain";
import type { MutationCtx } from "../../../_generated/server";
import { knockChannel } from "./knockChannel";

// Email channel, delivered through Knock: the workflow's email step is gated on
// `data.channel == "email"`. No-ops (with a log) when Knock is not configured, so opting a member
// into email never creates in-app rows — only inAppChannel persists.
export const emailChannel = (
  ctx: MutationCtx,
): ((notification: Notification) => Promise<void>) =>
  knockChannel(ctx, "email");
