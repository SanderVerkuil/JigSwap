import type { Id } from "../_generated/dataModel";
import { query } from "../_generated/server";
import { requireMember } from "../identity/requireMember";
import { enrichProposal } from "./proposalReadModel";

// Read side for the member's "my suggestions" view: their proposals across ALL statuses,
// newest first (pending ones are editable/withdrawable; decided ones show the outcome +
// rejection reason).
export const listMyChangeProposals = query({
  args: {},
  handler: async (ctx) => {
    const memberId = await requireMember(ctx);

    const mine = await ctx.db
      .query("puzzleChangeProposals")
      .withIndex("by_proposer", (q) =>
        // The domain MemberId is the user's Convex _id.
        q.eq("proposedBy", memberId as unknown as Id<"users">),
      )
      .order("desc")
      .collect();

    return Promise.all(mine.map((row) => enrichProposal(ctx, row)));
  },
});
