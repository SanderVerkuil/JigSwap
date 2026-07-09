import { ConvexError, v } from "convex/values";
import { query } from "../_generated/server";
import { isAdmin } from "../identity/isAdmin";
import { requireMember } from "../identity/requireMember";
import { enrichProposal } from "./proposalReadModel";

// Read side for the admin definition detail page: every proposal (open + decided) that targets
// this definition, newest first.
export const listProposalsForDefinition = query({
  args: { puzzleDefinitionId: v.string() },
  handler: async (ctx, args) => {
    await requireMember(ctx);
    if (!(await isAdmin(ctx))) throw new ConvexError("Forbidden");

    const rows = await ctx.db
      .query("puzzleChangeProposals")
      .withIndex("by_definition", (q) =>
        q.eq("puzzleDefinitionId", args.puzzleDefinitionId),
      )
      .order("desc")
      .collect();

    return Promise.all(rows.map((row) => enrichProposal(ctx, row)));
  },
});
