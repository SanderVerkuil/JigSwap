import type {
  TradePartnerReviewView,
  TradePartnerView,
} from "@jigswap/contracts";
import {
  toMemberId,
  tradeContactSharingOpen,
  tradeEmailVisible,
} from "@jigswap/domain";
import { v } from "convex/values";
import type { Doc, Id } from "../_generated/dataModel";
import { query, type QueryCtx } from "../_generated/server";
import { memberDisplayNameOf } from "../identity/memberDisplayName";
import { requireMember } from "../identity/requireMember";
import { canonicalHandleOf } from "../identity/resolveMemberByHandle";
import { blockStateBetween } from "../social/blocks";
import { projectMemberIdentity } from "../social/privacy";
import { contactShareOf, projectTradeParty } from "./tradeParty";

// Bound on the received reviews read for the average; matches computeMemberStats' cap.
const REVIEWS_CAP = 5000;
/** Reviews listed on the card, newest first. */
export const TRADE_PARTNER_REVIEW_ITEMS = 10;

// The counterparty card of ONE exchange, for one of its parties (null for anyone else). The
// per-trade chokepoint (exchange/tradeParty) decides hidden / departed / revealed; a revealed card
// carries ONLY display name, handle, the reviews the member RECEIVED and, once that member chose to
// share it in this trade (exchange/setContactSharing, domain rule tradeEmailVisible), their email —
// never avatar, bio, location, collection or activity, and it does not unlock the member's profile
// anywhere else (`profileViewable` says whether the ordinary rules already do). `emailSharing` is
// the viewer's OWN consent and whether sharing is open, for the switch on the card.
export const getTradePartner = query({
  args: { exchangeId: v.id("exchanges") },
  handler: async (ctx, args): Promise<TradePartnerView | null> => {
    const viewerId = (await requireMember(ctx)) as unknown as Id<"users">;
    const exchange = await ctx.db.get(args.exchangeId);
    if (!exchange) return null;
    if (
      viewerId !== exchange.initiatorId &&
      viewerId !== exchange.recipientId
    ) {
      return null;
    }
    const partnerId =
      viewerId === exchange.initiatorId
        ? exchange.recipientId
        : exchange.initiatorId;

    const party = await projectTradeParty(ctx, viewerId, exchange, partnerId);
    if (party.state === "departed") return { state: "departed" };
    if (party.state === "hidden" || !party.user) return { state: "hidden" };

    const user = party.user;
    const profile = await ctx.db
      .query("profiles")
      .withIndex("by_member", (q) => q.eq("memberId", partnerId))
      .unique();
    // The email needs the partner's own share in THIS trade; no reveal and no profile visibility
    // ever shows it (see TradePartnerView's doc).
    const viewerSide =
      viewerId === exchange.initiatorId ? "initiator" : "recipient";
    const partnerSide = viewerSide === "initiator" ? "recipient" : "initiator";
    const blocked =
      (await blockStateBetween(ctx, viewerId, partnerId)) !== undefined;
    const emailVisible = tradeEmailVisible({
      viewer: toMemberId(viewerId),
      party: toMemberId(partnerId),
      status: exchange.status,
      partyShared:
        (await contactShareOf(ctx, exchange._id, partnerSide)) !== null,
      blocked,
    });
    const name = memberDisplayNameOf(user, profile);

    return {
      state: "revealed",
      memberId: partnerId,
      ...(name !== undefined ? { name } : {}),
      ...(user.username !== undefined ? { username: user.username } : {}),
      handle: await canonicalHandleOf(ctx, user),
      ...(emailVisible && user.email !== undefined
        ? { email: user.email }
        : {}),
      emailSharing: {
        youShare:
          (await contactShareOf(ctx, exchange._id, viewerSide)) !== null,
        open: tradeContactSharingOpen({ status: exchange.status, blocked }),
      },
      profileViewable: party.state === "visible",
      reviews: await receivedReviews(ctx, viewerId, partnerId, exchange._id),
    };
  },
});

// Reviews the partner RECEIVED: the rounded average over all of them (capped) and the newest few.
// Reviewer names go through the ordinary privacy chokepoint; an anonymous reviewer is nameless (a
// departed one is flagged `reviewerDeparted`) and no reviewer id is ever returned.
const receivedReviews = async (
  ctx: QueryCtx,
  viewerId: Id<"users">,
  memberId: Id<"users">,
  salt: string,
) => {
  const reviews = await ctx.db
    .query("reviews")
    .withIndex("by_reviewee", (q) => q.eq("revieweeId", memberId))
    .take(REVIEWS_CAP);
  const average =
    reviews.length > 0
      ? reviews.reduce((sum, r) => sum + r.rating, 0) / reviews.length
      : 0;
  const newest = [...reviews]
    .sort((a, b) => b.createdAt - a.createdAt)
    .slice(0, TRADE_PARTNER_REVIEW_ITEMS);
  const items = await Promise.all(
    newest.map((r) => reviewItem(ctx, viewerId, r, salt)),
  );
  return {
    averageRating: Math.round(average * 10) / 10,
    totalReviews: reviews.length,
    items,
  };
};

const reviewItem = async (
  ctx: QueryCtx,
  viewerId: Id<"users">,
  review: Doc<"reviews">,
  salt: string,
): Promise<TradePartnerReviewView> => {
  const reviewer = await projectMemberIdentity(
    ctx,
    viewerId,
    review.reviewerId,
    salt,
  );
  let reviewerName: string | undefined;
  if (!reviewer.anonymous) {
    const profile = await ctx.db
      .query("profiles")
      .withIndex("by_member", (q) => q.eq("memberId", review.reviewerId))
      .unique();
    reviewerName = memberDisplayNameOf(reviewer.member, profile);
  }
  return {
    rating: review.rating,
    ...(review.comment !== undefined ? { comment: review.comment } : {}),
    createdAt: review.createdAt,
    ...(reviewerName !== undefined ? { reviewerName } : {}),
    ...(reviewer.anonymous && reviewer.departed
      ? { reviewerDeparted: true as const }
      : {}),
  };
};
