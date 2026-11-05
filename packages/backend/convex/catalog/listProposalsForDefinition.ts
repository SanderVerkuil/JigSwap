import { ConvexError, v } from "convex/values";
import { query } from "../_generated/server";
import { isAdmin } from "../identity/isAdmin";
import { requireMember } from "../identity/requireMember";
import { enrichProposal } from "./proposalReadModel";

// The most proposals the admin definition page shows. Withdrawing keeps the row and filing again adds
// another, so one member could otherwise grow this past what one read can load, and break the page
// used to review that definition. Every pending proposal is also on the queue
// (listPendingChangeProposals), however old it is.
export const MAX_DEFINITION_PROPOSALS = 100;

// Read side for the admin definition detail page: the newest proposals (open + decided) that target
// this definition, and whether there are older ones.
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
      .take(MAX_DEFINITION_PROPOSALS + 1);

    return {
      proposals: await Promise.all(
        rows
          .slice(0, MAX_DEFINITION_PROPOSALS)
          .map((row) => enrichProposal(ctx, row)),
      ),
      capped: rows.length > MAX_DEFINITION_PROPOSALS,
    };
  },
});
