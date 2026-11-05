import type { NotificationState, NotificationType } from "@jigswap/domain";
import type { Id } from "../../../_generated/dataModel";
import type { MutationCtx } from "../../../_generated/server";
import { consumeRateLimit } from "../../../lib/rateLimits";

// Follow notices reach a member's inbox or device at most once a day per actor and type on each
// out-of-band channel (SEC-23): a follow/unfollow or request/cancel loop, which the source limits
// (followPair) only slow down, emails and pushes the target once. The in-app channel is not held
// back here (new_follower rows group there instead).
const FOLLOW_NOTICE_TYPES: ReadonlySet<NotificationType> = new Set([
  "new_follower",
  "follow_request_received",
]);

/**
 * Whether `channel` may deliver this notification: always, unless it is a follow notice whose
 * actor already reached the recipient with that type on that channel in the current day
 * (RATE_LIMITS.followNotice, keyed "<channel>:<type>:<recipient>:<actor>"). A true counts it.
 */
export const followNoticeAllowed = async (
  ctx: MutationCtx,
  channel: "email" | "push",
  state: NotificationState,
): Promise<boolean> => {
  if (!FOLLOW_NOTICE_TYPES.has(state.type) || state.actorId === undefined) {
    return true;
  }
  return consumeRateLimit(
    ctx,
    "followNotice",
    `${channel}:${state.type}:${state.userId}:${state.actorId}`,
    {
      pairActorId: state.actorId as unknown as Id<"users">,
      pairTargetId: state.userId as unknown as Id<"users">,
    },
  );
};
