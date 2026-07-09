import { ConvexError } from "convex/values";
import { query } from "../_generated/server";
import { isAdmin } from "../identity/isAdmin";
import { requireMember } from "../identity/requireMember";
import { enrichProposal } from "./proposalReadModel";

// Read side for the admin proposals queue: every PENDING community change proposal, newest
// first, enriched with definition context, proposer, and derived conflict flags.
export const listPendingChangeProposals = query({
  args: {},
  handler: async (ctx) => {
    await requireMember(ctx);
    if (!(await isAdmin(ctx))) throw new ConvexError("Forbidden");

    const pending = await ctx.db
      .query("puzzleChangeProposals")
      .withIndex("by_status", (q) => q.eq("status", "pending"))
      .order("desc")
      .collect();

    return Promise.all(pending.map((row) => enrichProposal(ctx, row)));
  },
});
