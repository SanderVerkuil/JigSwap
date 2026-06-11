import type {
  CopyId,
  Exchange,
  ExchangeId,
  ExchangeRepository,
  MemberId,
} from "@jigswap/domain";
import type { Id } from "../../_generated/dataModel";
import type { MutationCtx } from "../../_generated/server";
import { toDomain, toRow } from "./mapper";

// Driven adapter for the ExchangeRepository port over `ctx.db`. The only place the
// `exchanges` table is read/written for the domain path; the mapper is the ACL.
export const convexExchangeRepository = (
  ctx: MutationCtx,
): ExchangeRepository => ({
  async findById(id: ExchangeId): Promise<Exchange | null> {
    const row = await ctx.db
      .query("exchanges")
      .withIndex("by_aggregate_id", (q) => q.eq("aggregateId", id as string))
      .unique();
    return row ? toDomain(row) : null;
  },

  async save(exchange: Exchange): Promise<void> {
    const row = toRow(exchange);
    const existing = await ctx.db
      .query("exchanges")
      .withIndex("by_aggregate_id", (q) => q.eq("aggregateId", row.aggregateId))
      .unique();
    if (existing) await ctx.db.patch(existing._id, row);
    else await ctx.db.insert("exchanges", row);
  },

  async findActiveProposal(
    initiatorId: MemberId,
    requestedCopyId: CopyId,
  ): Promise<Exchange | null> {
    const row = await ctx.db
      .query("exchanges")
      .withIndex("by_initiator", (q) =>
        q.eq("initiatorId", initiatorId as unknown as Id<"users">),
      )
      .filter((q) =>
        q.and(
          q.eq(
            q.field("requestedPuzzleId"),
            requestedCopyId as unknown as Id<"ownedPuzzles">,
          ),
          q.eq(q.field("status"), "proposed"),
          // only domain-written rows participate in the new dedup
          q.neq(q.field("aggregateId"), undefined),
        ),
      )
      .first();
    return row ? toDomain(row) : null;
  },
});
