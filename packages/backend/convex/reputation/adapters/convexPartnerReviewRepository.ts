import {
  type ExchangeId,
  type MemberId,
  type PartnerReview,
  type PartnerReviewRepository,
  toExchangeId,
} from "@jigswap/domain";
import type { Doc, Id } from "../../_generated/dataModel";
import type { MutationCtx } from "../../_generated/server";
import { toDomain, toRow } from "./partnerReviewMapper";

// Driven adapter for the PartnerReviewRepository port over `ctx.db` (the `reviews` table). The
// only place that table is read/written for the Reputation domain path; the mapper is the ACL.
// The `exchangeId` is a `v.id("exchanges")` FK column, so it must hold a genuine document id —
// the repository resolves it from the domain's ExchangeId aggregateId.
export const convexPartnerReviewRepository = (
  ctx: MutationCtx,
): PartnerReviewRepository => {
  const rowByAggregateId = (
    id: PartnerReview["id"],
  ): Promise<Doc<"reviews"> | null> =>
    ctx.db
      .query("reviews")
      .withIndex("by_aggregate_id", (q) => q.eq("aggregateId", id as string))
      .unique();

  // Resolve the real `exchanges._id` for an ExchangeId aggregateId; legacy exchanges that predate
  // aggregateId fall back to treating the value as a raw `_id`.
  const resolveExchangeId = async (
    exchangeId: ExchangeId,
  ): Promise<Id<"exchanges">> => {
    const byAggregateId = await ctx.db
      .query("exchanges")
      .withIndex("by_aggregate_id", (q) =>
        q.eq("aggregateId", exchangeId as string),
      )
      .unique();
    return byAggregateId
      ? byAggregateId._id
      : (exchangeId as unknown as Id<"exchanges">);
  };

  // Map a stored `exchanges._id` back to its ExchangeId aggregateId for the domain.
  const exchangeAggregateId = async (
    exchangeId: Id<"exchanges">,
  ): Promise<ExchangeId> => {
    const row = await ctx.db.get(exchangeId);
    return toExchangeId(
      (row?.aggregateId ?? (exchangeId as unknown as string)) as string,
    ) as ExchangeId;
  };

  const hydrate = async (row: Doc<"reviews">): Promise<PartnerReview> =>
    toDomain(row, await exchangeAggregateId(row.exchangeId));

  return {
    async findByExchangeAndReviewer(
      exchangeId: ExchangeId,
      reviewerId: MemberId,
    ): Promise<PartnerReview | null> {
      // The uniqueness lookup keys on the RESOLVED exchange `_id` (what the FK column holds).
      const resolvedExchangeId = await resolveExchangeId(exchangeId);
      const row = await ctx.db
        .query("reviews")
        .withIndex("by_exchange_reviewer", (q) =>
          q
            .eq("exchangeId", resolvedExchangeId)
            .eq("reviewerId", reviewerId as unknown as Id<"users">),
        )
        .first();
      // Only domain-written/backfilled rows (which carry an aggregateId) can be rehydrated.
      return row && row.aggregateId !== undefined ? hydrate(row) : null;
    },

    async save(review: PartnerReview): Promise<void> {
      const mapped = toRow(review);
      const state = review.toState();
      const row = {
        ...mapped,
        exchangeId: await resolveExchangeId(state.exchangeId),
      };
      const existing = await rowByAggregateId(review.id);
      if (existing) await ctx.db.patch(existing._id, row);
      else await ctx.db.insert("reviews", row);
    },

    async listForReviewee(
      revieweeId: MemberId,
    ): Promise<readonly PartnerReview[]> {
      const rows = await ctx.db
        .query("reviews")
        .withIndex("by_reviewee", (q) =>
          q.eq("revieweeId", revieweeId as unknown as Id<"users">),
        )
        .collect();
      // Only domain-written/backfilled rows participate in the new path.
      const owned = rows.filter((row) => row.aggregateId !== undefined);
      return Promise.all(owned.map((row) => hydrate(row)));
    },
  };
};
