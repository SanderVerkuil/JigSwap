import type { ShareCopiesResultView } from "@jigswap/contracts";
import {
  makeShareCopiesToCircle,
  toCircleId,
  toCopyId,
  type MemberId,
} from "@jigswap/domain";
import { ConvexError, v } from "convex/values";
import type { Id } from "../_generated/dataModel";
import { mutation } from "../_generated/server";
import { requireMember } from "../identity/requireMember";
import { enforceRateLimit } from "../lib/rateLimits";
import {
  copyNotFound,
  isCopySharedInto,
  ownCopyOf,
} from "./adapters/circleCopyShares";
import { convexCircleRepository } from "./adapters/convexCircleRepository";
import { inProcessEventPublisher } from "./adapters/inProcessEventPublisher";
import { systemClock } from "./adapters/systemClock";
import { toConvexError } from "./errors";

/** The most copies one call may share (the circle page's multi-select sends its selection). */
export const MAX_SHARE_BATCH = 100;

// Composition root for sharing a selection of the caller's copies into a circle at once. All or
// nothing: every copy must be the caller's (one generic CopyNotFound otherwise), and the caller's
// seat must allow sharing (makeShareCopiesToCircle: CannotShareCopy for View only, CircleNotFound
// for a non-member or an unknown circle). Copies already shared there are left as they are (no
// second event) and counted as `alreadyShared`; duplicates in `copyIds` count once.
export const shareCopiesToCircle = mutation({
  args: {
    circleId: v.string(),
    copyIds: v.array(v.string()),
  },
  handler: async (ctx, args): Promise<ShareCopiesResultView> => {
    const actorId = await requireMember(ctx);
    const copyIds = [...new Set(args.copyIds)];
    if (copyIds.length > MAX_SHARE_BATCH) {
      throw new ConvexError({
        code: "BatchTooLarge",
        message: `Share at most ${MAX_SHARE_BATCH} copies at once`,
      });
    }

    // Sharing never loads the Copy, so ownership is checked here, before anything is shared.
    for (const copyId of copyIds) {
      if (!(await ownCopyOf(ctx, actorId as unknown as Id<"users">, copyId))) {
        throw copyNotFound();
      }
    }

    const toShare: string[] = [];
    for (const copyId of copyIds) {
      if (!(await isCopySharedInto(ctx, args.circleId, copyId))) {
        toShare.push(copyId);
      }
    }

    // Each copy actually shared counts against the member's daily budget; a batch that doesn't fit
    // is refused whole. Copies already there cost nothing.
    if (toShare.length > 0) {
      await enforceRateLimit(
        ctx,
        "circleShare",
        actorId,
        undefined,
        toShare.length,
      );
    }

    // Runs even when everything was already shared, so the seat gate always answers.
    const result = await makeShareCopiesToCircle({
      circles: convexCircleRepository(ctx),
      events: inProcessEventPublisher(ctx),
      clock: systemClock,
    })({
      circleId: toCircleId(args.circleId),
      actorId: actorId as MemberId,
      copyIds: toShare.map(toCopyId),
    });
    if (result.isErr) throw toConvexError(result.error);

    return {
      shared: toShare.length,
      alreadyShared: copyIds.length - toShare.length,
    };
  },
});
