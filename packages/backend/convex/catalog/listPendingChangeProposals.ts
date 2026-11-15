import { query } from "../_generated/server";
import { requireAdmin } from "../identity/isAdmin";
import { PENDING_QUEUE_LIMIT } from "./pendingQueue";
import { enrichProposal } from "./proposalReadModel";

// Read side for the admin proposals queue: the newest PENDING community change proposals, enriched
// with definition context, proposer, and derived conflict flags.
export const listPendingChangeProposals = query({
  args: {},
  handler: async (ctx) => {
    await requireAdmin(ctx);

    const pending = await ctx.db
      .query("puzzleChangeProposals")
      .withIndex("by_status", (q) => q.eq("status", "pending"))
      .order("desc")
      .take(PENDING_QUEUE_LIMIT);

    return Promise.all(pending.map((row) => enrichProposal(ctx, row)));
  },
});
