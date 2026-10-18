import {
  makeDeleteCircle,
  SharingApplicationError,
  SharingError,
  toCircleId,
} from "@jigswap/domain";
import { v } from "convex/values";
import { mutation } from "../_generated/server";
import { requireMember } from "../identity/requireMember";
import { convexCircleRepository } from "./adapters/convexCircleRepository";
import { inProcessEventPublisher } from "./adapters/inProcessEventPublisher";
import { systemClock } from "./adapters/systemClock";
import { toConvexError } from "./errors";

// The longest confirmName worth comparing: a bound on input, not a name rule. Only NEW circle names
// are capped (at 100 characters); circles stored before that may have longer names, so this sits
// far above any real name; a lower cap would make such a circle undeletable.
export const MAX_CONFIRM_NAME_LENGTH = 1000;

// Composition root for deleting a circle. Only the owner may, by typing the circle's exact name as
// `confirmName`. In this transaction the circle, its memberships and its invites go and
// CircleDeleted is recorded; its copy-share links are purged by a scheduled job.
export const deleteCircle = mutation({
  args: {
    circleId: v.string(),
    confirmName: v.string(),
  },
  handler: async (ctx, args) => {
    const actorId = await requireMember(ctx);
    // Refuse an oversized confirmation before any read. The answer is independent of the circle id,
    // so it reveals nothing about which circles exist.
    if (args.confirmName.length > MAX_CONFIRM_NAME_LENGTH) {
      throw toConvexError(SharingError.confirmationMismatch());
    }

    const deleteCircleUseCase = makeDeleteCircle({
      circles: convexCircleRepository(ctx),
      events: inProcessEventPublisher(ctx),
      clock: systemClock,
    });

    const circleId = toCircleId(args.circleId);
    const result = await deleteCircleUseCase({
      circleId,
      actorId,
      confirmName: args.confirmName,
    });
    if (result.isErr) {
      // A non-member gets exactly the not-found error, so this path can't be used to probe which
      // circle ids exist (or their names).
      throw toConvexError(
        result.error.code === "NotAMember"
          ? SharingApplicationError.circleNotFound(circleId)
          : result.error,
      );
    }
  },
});
