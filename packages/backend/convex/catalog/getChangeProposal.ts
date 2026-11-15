import { v } from "convex/values";
import { query } from "../_generated/server";
import { requireAdmin } from "../identity/isAdmin";
import { enrichProposal } from "./proposalReadModel";

// Read side for the proposal review screen: ONE proposal by its aggregate id, any status —
// decided/withdrawn proposals render read-only. Enriched like the list reads.
export const getChangeProposal = query({
  args: { changeProposalId: v.string() },
  handler: async (ctx, args) => {
    await requireAdmin(ctx);

    const row = await ctx.db
      .query("puzzleChangeProposals")
      .withIndex("by_aggregate_id", (q) =>
        q.eq("aggregateId", args.changeProposalId),
      )
      .unique();
    return row ? enrichProposal(ctx, row) : null;
  },
});
