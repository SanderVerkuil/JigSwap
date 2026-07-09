import { makeApproveChangeProposal, toChangeProposalId } from "@jigswap/domain";
import { ConvexError, v } from "convex/values";
import type { Id } from "../_generated/dataModel";
import { mutation } from "../_generated/server";
import { stampModerationAction } from "../admin/stampModerationAction";
import { isAdmin } from "../identity/isAdmin";
import { requireMember } from "../identity/requireMember";
import { convexChangeProposalRepository } from "./adapters/convexChangeProposalRepository";
import { convexPuzzleDefinitionRepository } from "./adapters/convexPuzzleDefinitionRepository";
import { catalogEventPublisher } from "./adapters/eventPublisher";
import { systemClock } from "./adapters/systemClock";
import { toConvexError } from "./errors";

// Moderation: approve a pending change proposal. The use case orchestrates BOTH aggregates in
// this one transaction — the proposal is approved AND the patch lands on the definition
// atomically. Domain events carry no actor, so the composition root stamps the deciding admin.
export const approveChangeProposal = mutation({
  args: { changeProposalId: v.string() },
  handler: async (ctx, args) => {
    const memberId = await requireMember(ctx);
    if (!(await isAdmin(ctx))) throw new ConvexError("Forbidden");

    const approve = makeApproveChangeProposal({
      proposals: convexChangeProposalRepository(ctx),
      definitions: convexPuzzleDefinitionRepository(ctx),
      events: catalogEventPublisher(ctx),
      clock: systemClock,
    });
    const result = await approve({
      changeProposalId: toChangeProposalId(args.changeProposalId),
    });
    if (result.isErr) throw toConvexError(result.error);

    // Audit stamp: label with the (now updated) definition title. The action succeeded, so
    // both rows exist. targetId is the DEFINITION aggregate id — this stamp joins the
    // definition's own audit trail (moderationActions.by_target) alongside every
    // definition_* stamp; the proposal id remains visible via targetLabel context.
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
      kind: "proposal_approved",
      targetLabel: puzzle?.title ?? args.changeProposalId,
      targetId: proposal?.puzzleDefinitionId ?? args.changeProposalId,
    });
  },
});
