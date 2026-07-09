import { makeRejectChangeProposal, toChangeProposalId } from "@jigswap/domain";
import { ConvexError, v } from "convex/values";
import type { Id } from "../_generated/dataModel";
import { mutation } from "../_generated/server";
import { stampModerationAction } from "../admin/stampModerationAction";
import { isAdmin } from "../identity/isAdmin";
import { requireMember } from "../identity/requireMember";
import { convexChangeProposalRepository } from "./adapters/convexChangeProposalRepository";
import { catalogEventPublisher } from "./adapters/eventPublisher";
import { systemClock } from "./adapters/systemClock";
import { toConvexError } from "./errors";

// Moderation: reject a pending change proposal with an optional reason (stored on the proposal,
// carried on the domain event, surfaced to the proposer). The definition is never touched.
export const rejectChangeProposal = mutation({
  args: { changeProposalId: v.string(), reason: v.optional(v.string()) },
  handler: async (ctx, args) => {
    const memberId = await requireMember(ctx);
    if (!(await isAdmin(ctx))) throw new ConvexError("Forbidden");

    const reject = makeRejectChangeProposal({
      proposals: convexChangeProposalRepository(ctx),
      events: catalogEventPublisher(ctx),
      clock: systemClock,
    });
    const result = await reject({
      changeProposalId: toChangeProposalId(args.changeProposalId),
      reason: args.reason,
    });
    if (result.isErr) throw toConvexError(result.error);

    const proposal = await ctx.db
      .query("puzzleChangeProposals")
      .withIndex("by_aggregate_id", (q) =>
        q.eq("aggregateId", args.changeProposalId),
      )
      .unique();
    const puzzle = proposal
      ? await ctx.db
          .query("puzzles")
          .withIndex("by_aggregate_id", (q) =>
            q.eq("aggregateId", proposal.puzzleDefinitionId),
          )
          .unique()
      : null;
    await stampModerationAction(ctx, {
      actorId: memberId as unknown as Id<"users">,
      kind: "proposal_rejected",
      targetLabel: puzzle?.title ?? args.changeProposalId,
      targetId: args.changeProposalId,
    });
  },
});
