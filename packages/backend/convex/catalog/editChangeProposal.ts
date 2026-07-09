import { makeEditChangeProposal, toChangeProposalId } from "@jigswap/domain";
import { ConvexError, v } from "convex/values";
import { mutation } from "../_generated/server";
import { requireMember } from "../identity/requireMember";
import { convexChangeProposalRepository } from "./adapters/convexChangeProposalRepository";
import { convexPuzzleDefinitionRepository } from "./adapters/convexPuzzleDefinitionRepository";
import { catalogEventPublisher } from "./adapters/eventPublisher";
import { systemClock } from "./adapters/systemClock";
import { toConvexError } from "./errors";
import { proposalFieldArgs, toChanges } from "./proposeDefinitionChange";

// Composition root: the proposer replaces their PENDING proposal's diff/comment in place.
// Ownership ACL here (like updatePuzzleDefinition); the pending-only rule is the aggregate's.
export const editChangeProposal = mutation({
  args: {
    changeProposalId: v.string(),
    comment: v.optional(v.string()),
    ...proposalFieldArgs,
  },
  handler: async (ctx, args) => {
    const actingMember = await requireMember(ctx);

    const proposals = convexChangeProposalRepository(ctx);
    const existing = await proposals.findById(
      toChangeProposalId(args.changeProposalId),
    );
    if (!existing) throw new ConvexError("Not found");
    if (
      (existing.proposedBy as unknown as string) !==
      (actingMember as unknown as string)
    ) {
      throw new ConvexError("Forbidden");
    }

    const edit = makeEditChangeProposal({
      proposals,
      definitions: convexPuzzleDefinitionRepository(ctx),
      events: catalogEventPublisher(ctx),
      clock: systemClock,
    });

    const result = await edit({
      changeProposalId: toChangeProposalId(args.changeProposalId),
      changes: toChanges(args),
      comment: args.comment,
    });
    if (result.isErr) throw toConvexError(result.error);
  },
});
