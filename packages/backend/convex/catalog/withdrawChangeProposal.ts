import {
  makeWithdrawChangeProposal,
  toChangeProposalId,
} from "@jigswap/domain";
import { ConvexError, v } from "convex/values";
import { mutation } from "../_generated/server";
import { requireMember } from "../identity/requireMember";
import { convexChangeProposalRepository } from "./adapters/convexChangeProposalRepository";
import { catalogEventPublisher } from "./adapters/eventPublisher";
import { systemClock } from "./adapters/systemClock";
import { toConvexError } from "./errors";

// Composition root: the proposer retracts their PENDING proposal. Ownership ACL here; the
// pending-only rule is the aggregate's.
export const withdrawChangeProposal = mutation({
  args: { changeProposalId: v.string() },
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

    const withdraw = makeWithdrawChangeProposal({
      proposals,
      events: catalogEventPublisher(ctx),
      clock: systemClock,
    });

    const result = await withdraw({
      changeProposalId: toChangeProposalId(args.changeProposalId),
    });
    if (result.isErr) throw toConvexError(result.error);
  },
});
