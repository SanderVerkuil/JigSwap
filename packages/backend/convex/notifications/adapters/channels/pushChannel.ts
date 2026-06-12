import type { Notification } from "@jigswap/domain";
import type { MutationCtx } from "../../../_generated/server";
import { knockChannel } from "./knockChannel";

// Push channel, delivered through Knock: the workflow's push step is gated on
// `data.channel == "push"`. No-ops (with a log) when Knock is not configured, so opting a member
// into push never creates in-app rows — only inAppChannel persists.
export const pushChannel = (
  ctx: MutationCtx,
): ((notification: Notification) => Promise<void>) => knockChannel(ctx, "push");
