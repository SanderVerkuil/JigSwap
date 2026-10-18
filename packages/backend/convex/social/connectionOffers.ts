import {
  ConnectionOffer,
  toConnectionOfferId,
  toMemberId,
  type ConnectionOfferSource,
} from "@jigswap/domain";
import { ConvexError, v } from "convex/values";
import { internal } from "../_generated/api";
import type { Doc, Id } from "../_generated/dataModel";
import { internalMutation, type MutationCtx } from "../_generated/server";
import { inProcessEventPublisher } from "./adapters/inProcessEventPublisher";
import { inDeclineCooldownEitherWay } from "./establishMutualFollow";
import { areMutualFollowers } from "./privacy";

// Confirm-first connections: an invite link redeemed at sign-up OFFERS the new member a mutual
// follow with the link's owner, and nothing is followed until they accept (acceptConnection).
// The ConnectionOffer aggregate decides the transitions; this module persists them.

// The one error for an unknown, foreign, answered or expired offer, so a caller learns nothing
// about offers that aren't theirs.
export const connectionOfferUnavailable = (): ConvexError<{
  code: string;
  message: string;
}> =>
  new ConvexError({
    code: "ConnectionOfferUnavailable",
    message: "This invitation is no longer available",
  });

const rehydrate = (row: Doc<"connectionOffers">): ConnectionOffer =>
  ConnectionOffer.rehydrate({
    id: toConnectionOfferId(row.aggregateId),
    fromId: toMemberId(row.fromId),
    toId: toMemberId(row.toId),
    source: row.source,
    status: row.status,
    createdAt: new Date(row.createdAt),
    expiresAt: new Date(row.expiresAt),
    ...(row.respondedAt !== undefined
      ? { respondedAt: new Date(row.respondedAt) }
      : {}),
  });

// Offer `toId` a connection with `fromId`. "skipped" when no offer may exist: a follow request
// between them was declined inside the cooldown (a link must not even ask), or they already follow
// each other. A still-open offer for the same ordered pair is reused (one pending per pair).
export async function offerConnection(
  ctx: MutationCtx,
  args: {
    fromId: Id<"users">;
    toId: Id<"users">;
    source: ConnectionOfferSource;
    inviteLinkId: Id<"inviteLinks">;
  },
): Promise<"pending" | "skipped"> {
  const now = Date.now();
  // TODO(blocks): when social/blocks.ts lands, skip the offer if isBlockedEitherWay(fromId, toId).
  if (await inDeclineCooldownEitherWay(ctx, args.fromId, args.toId, now)) {
    return "skipped";
  }
  if (await areMutualFollowers(ctx, args.fromId, args.toId)) return "skipped";

  const existing = await ctx.db
    .query("connectionOffers")
    .withIndex("by_from_to_status", (q) =>
      q.eq("fromId", args.fromId).eq("toId", args.toId).eq("status", "pending"),
    )
    .first();
  if (existing !== null) {
    const earlier = rehydrate(existing);
    if (earlier.isOpen(new Date(now))) return "pending";
    // Lapsed but its scheduled expire hasn't run yet: expire it now, so one pending row remains.
    earlier.expire(new Date(now));
    await ctx.db.patch(existing._id, { status: earlier.status });
  }

  const created = ConnectionOffer.offer({
    id: toConnectionOfferId(crypto.randomUUID()),
    fromId: toMemberId(args.fromId),
    toId: toMemberId(args.toId),
    source: args.source,
    now: new Date(now),
  });
  if (created.isErr) return "skipped";
  const offer = created.value;
  const state = offer.toState();

  await ctx.db.insert("connectionOffers", {
    aggregateId: state.id,
    fromId: args.fromId,
    toId: args.toId,
    source: state.source,
    inviteLinkId: args.inviteLinkId,
    status: state.status,
    createdAt: state.createdAt.getTime(),
    expiresAt: state.expiresAt.getTime(),
  });
  await inProcessEventPublisher(ctx).publish(offer.pullEvents());
  await ctx.scheduler.runAt(
    state.expiresAt.getTime(),
    internal.social.connectionOffers.expireConnectionOffer,
    { offerId: state.id },
  );
  return "pending";
}

// Load an offer for its recipient to answer. Anything else (unknown id, someone else's offer) is
// the same generic error.
export async function loadOfferForRecipient(
  ctx: MutationCtx,
  recipientId: Id<"users">,
  offerId: string,
): Promise<{ row: Doc<"connectionOffers">; offer: ConnectionOffer }> {
  const row = await ctx.db
    .query("connectionOffers")
    .withIndex("by_aggregate_id", (q) => q.eq("aggregateId", offerId))
    .unique();
  if (row === null || row.toId !== recipientId) {
    throw connectionOfferUnavailable();
  }
  return { row, offer: rehydrate(row) };
}

// Scheduled at the offer's expiresAt. A no-op once the offer was answered (or is gone).
export const expireConnectionOffer = internalMutation({
  args: { offerId: v.string() },
  handler: async (ctx, { offerId }): Promise<void> => {
    const row = await ctx.db
      .query("connectionOffers")
      .withIndex("by_aggregate_id", (q) => q.eq("aggregateId", offerId))
      .unique();
    if (row === null) return;
    const offer = rehydrate(row);
    if (offer.expire(new Date()).isErr) return;
    await ctx.db.patch(row._id, { status: offer.status });
  },
});
