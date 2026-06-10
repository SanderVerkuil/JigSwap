import {
  makeShareCopyToCircle,
  type MemberId,
  toCircleId,
  toCopyId,
} from "@jigswap/domain";
import { v } from "convex/values";
import { mutation } from "../_generated/server";
import { requireMember } from "../identity/requireMember";
import { convexCircleRepository } from "./adapters/convexCircleRepository";
import { inProcessEventPublisher } from "./adapters/inProcessEventPublisher";
import { systemClock } from "./adapters/systemClock";
import { toConvexError } from "./errors";

// Composition root for sharing a copy into a circle. The actor is derived from auth; the aggregate
// gates the share on Admin. `copyId` is the Library CopyId aggregateId — Sharing only announces the
// link (the CopySharedToCircle projection materialises it), it never loads the Copy.
export const shareCopyToCircle = mutation({
  args: {
    circleId: v.string(),
    copyId: v.string(),
  },
  handler: async (ctx, args) => {
    const actorId = await requireMember(ctx);

    const shareCopyToCircle = makeShareCopyToCircle({
      circles: convexCircleRepository(ctx),
      events: inProcessEventPublisher(ctx),
      clock: systemClock,
    });

    const result = await shareCopyToCircle({
      circleId: toCircleId(args.circleId),
      actorId: actorId as MemberId,
      copyId: toCopyId(args.copyId),
    });
    if (result.isErr) throw toConvexError(result.error);
  },
});
