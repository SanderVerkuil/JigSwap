import type { MessageCopyView } from "@jigswap/contracts";
import { SharingApplicationError, toCircleId } from "@jigswap/domain";
import { v } from "convex/values";
import type { Doc, Id } from "../_generated/dataModel";
import { query } from "../_generated/server";
import { messageCopyViewOf } from "../conversation/copyCard";
import { requireMember } from "../identity/requireMember";
import {
  buildCopyViewContext,
  canViewCopyWithContext,
} from "../library/canViewCopy";
import { isCopyPrivate } from "../library/copyVisibility";
import { sharesOfCircleWithin } from "./adapters/circleCopyShares";
import { circleByAggregateId } from "./circleAccess";
import { toConvexError } from "./errors";

// How many of the circle's shares are read (going round its members when there are more,
// sharesOfCircleWithin) and how many cards are returned. The circle page shows a compact strip; there
// is no full per-circle list to link to yet. A member past their share of the strip waits until everyone
// else's have had a place, so one member's newest copies can't fill it.
const SHARES_SCAN_CAP = 100;
export const CIRCLE_SHARED_COPIES_LIMIT = 12;
export const CIRCLE_SHARED_COPIES_OWNER_SHARE = 4;

// Sharing read: the copies shared into one circle, as compact cards for its page. Members only:
// an unknown circle, a non-member and an ex-member all get the same CircleNotFound, so the read
// can't be used to probe which circles exist. A share counts only while its copy's owner is still
// a member of THIS circle (a stale share left behind exposes nothing), the copy isn't private
// (the owner's toggle wins over the share) and the viewer may view it (canViewCopy, which also
// drops copies of members blocked either way). Newest shares first, within what one member may take.
export const listCircleSharedCopies = query({
  args: { circleId: v.string() },
  handler: async (ctx, args): Promise<MessageCopyView[]> => {
    const viewerId = (await requireMember(ctx)) as unknown as Id<"users">;
    const circle = await circleByAggregateId(ctx, args.circleId);
    if (!circle || !circle.memberships.some((m) => m.memberId === viewerId)) {
      throw toConvexError(
        SharingApplicationError.circleNotFound(toCircleId(args.circleId)),
      );
    }
    const memberIds = new Set(circle.memberships.map((m) => m.memberId));

    const shares = await sharesOfCircleWithin(
      ctx,
      args.circleId,
      [...memberIds],
      SHARES_SCAN_CAP,
    );
    shares.sort((a, b) => b._creationTime - a._creationTime);

    const context = await buildCopyViewContext(ctx, viewerId);
    const cards: MessageCopyView[] = [];
    const heldBack: Doc<"ownedPuzzles">[] = [];
    const placedOf = new Map<Id<"users">, number>();
    for (const share of shares) {
      if (cards.length >= CIRCLE_SHARED_COPIES_LIMIT) break;
      const copy = await ctx.db
        .query("ownedPuzzles")
        .withIndex("by_aggregate_id", (q) => q.eq("aggregateId", share.copyId))
        .unique();
      if (!copy || !memberIds.has(copy.ownerId) || isCopyPrivate(copy)) {
        continue;
      }
      // A member who deleted their account keeps a seat until the deletion cascade removes it;
      // their copies are not shown (a tombstoned or missing user row).
      const owner = await ctx.db.get(copy.ownerId);
      if (owner?.isActive !== true) continue;
      if (!(await canViewCopyWithContext(ctx, copy, context))) continue;
      const placed = placedOf.get(copy.ownerId) ?? 0;
      if (placed >= CIRCLE_SHARED_COPIES_OWNER_SHARE) {
        heldBack.push(copy);
        continue;
      }
      placedOf.set(copy.ownerId, placed + 1);
      cards.push(await messageCopyViewOf(ctx, copy));
    }
    for (const copy of heldBack) {
      if (cards.length >= CIRCLE_SHARED_COPIES_LIMIT) break;
      cards.push(await messageCopyViewOf(ctx, copy));
    }
    return cards;
  },
});
