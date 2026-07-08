import {
  type ChangeProposalId,
  type ChangeProposalRepository,
  type PuzzleChangeProposal,
  type PuzzleDefinitionId,
  type SubmitterId,
} from "@jigswap/domain";
import type { Id } from "../../_generated/dataModel";
import type { MutationCtx } from "../../_generated/server";
import { toDomain, toRow } from "./proposalMapper";

// Driven adapter for the ChangeProposalRepository port over `ctx.db`. The only place the
// `puzzleChangeProposals` table is read/written for the domain path; the mapper is the ACL.
export const convexChangeProposalRepository = (
  ctx: MutationCtx,
): ChangeProposalRepository => ({
  async findById(id: ChangeProposalId): Promise<PuzzleChangeProposal | null> {
    const row = await ctx.db
      .query("puzzleChangeProposals")
      .withIndex("by_aggregate_id", (q) => q.eq("aggregateId", id as string))
      .unique();
    return row ? toDomain(row) : null;
  },

  // Backs the one-open-proposal rule. `by_proposer` is (proposedBy, status), so the pending
  // rows of this member are one indexed scan; the definition filter is applied in memory.
  async findPendingByDefinitionAndProposer(
    definitionId: PuzzleDefinitionId,
    proposer: SubmitterId,
  ): Promise<PuzzleChangeProposal | null> {
    const pending = await ctx.db
      .query("puzzleChangeProposals")
      .withIndex("by_proposer", (q) =>
        q
          .eq("proposedBy", proposer as unknown as Id<"users">)
          .eq("status", "pending"),
      )
      .collect();
    const match = pending.find(
      (row) => row.puzzleDefinitionId === (definitionId as string),
    );
    return match ? toDomain(match) : null;
  },

  async save(proposal: PuzzleChangeProposal): Promise<void> {
    const row = toRow(proposal);
    const existing = await ctx.db
      .query("puzzleChangeProposals")
      .withIndex("by_aggregate_id", (q) => q.eq("aggregateId", row.aggregateId))
      .unique();
    if (existing) await ctx.db.patch(existing._id, row);
    else await ctx.db.insert("puzzleChangeProposals", row);
  },
});
