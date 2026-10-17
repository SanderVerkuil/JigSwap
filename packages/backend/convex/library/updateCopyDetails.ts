import { makeUpdateCopyDetails, toCopyId, type OwnerId } from "@jigswap/domain";
import { v } from "convex/values";
import { mutation } from "../_generated/server";
import { convexCopyManagerPolicy } from "../household/copyAccess";
import { requireMember } from "../identity/requireMember";
import { convexCopyRepository } from "./adapters/convexCopyRepository";
import { libraryEventPublisher } from "./adapters/eventPublisher";
import { systemClock } from "./adapters/systemClock";
import { toConvexError } from "./errors";

// Composition root for patching a copy's descriptive fields (missing-piece count, notes).
// `copyId` is the domain aggregateId; omitted fields are left unchanged.
export const updateCopyDetails = mutation({
  args: {
    copyId: v.string(),
    missingPiecesCount: v.optional(v.number()),
    notes: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const actingMemberId = (await requireMember(ctx)) as unknown as OwnerId;

    const update = makeUpdateCopyDetails({
      copies: convexCopyRepository(ctx),
      events: libraryEventPublisher(ctx),
      clock: systemClock,
      // Household members with manage permission act as co-owner.
      managers: convexCopyManagerPolicy(ctx),
    });

    const result = await update({
      actingMemberId,
      copyId: toCopyId(args.copyId),
      missingPiecesCount: args.missingPiecesCount,
      notes: args.notes,
    });
    if (result.isErr) throw toConvexError(result.error);
  },
});
