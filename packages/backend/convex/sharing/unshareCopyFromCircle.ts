import { SharingApplicationError, toCircleId } from "@jigswap/domain";
import { v } from "convex/values";
import type { Id } from "../_generated/dataModel";
import { mutation } from "../_generated/server";
import { requireMember } from "../identity/requireMember";
import {
  copyNotFound,
  deleteCircleSharesOfCopy,
  ownCopyOf,
} from "./adapters/circleCopyShares";
import { circleByAggregateId } from "./circleAccess";
import { toConvexError } from "./errors";

// Take a share back: the copy stops being shared into this one circle (its other circles keep
// it). Only the copy's owner may, whatever their seat: a member moved to View only keeps the
// shares they made and can still end them. Someone else's copy and a missing one get the same
// CopyNotFound; a non-member gets CircleNotFound, as for an unknown circle. Unsharing a copy that
// isn't shared there is a no-op.
export const unshareCopyFromCircle = mutation({
  args: {
    circleId: v.string(),
    copyId: v.string(),
  },
  handler: async (ctx, args): Promise<null> => {
    const actorId = (await requireMember(ctx)) as unknown as Id<"users">;
    if (!(await ownCopyOf(ctx, actorId, args.copyId))) throw copyNotFound();

    const circle = await circleByAggregateId(ctx, args.circleId);
    if (!circle || !circle.memberships.some((m) => m.memberId === actorId)) {
      throw toConvexError(
        SharingApplicationError.circleNotFound(toCircleId(args.circleId)),
      );
    }

    await deleteCircleSharesOfCopy(ctx, args.copyId, args.circleId);
    return null;
  },
});
