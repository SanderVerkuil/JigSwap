import { makeUpdateCopyDetails, type OwnerId, toCopyId } from "@jigswap/domain";
import { v } from "convex/values";
import { mutation } from "../_generated/server";
import { requireMember } from "../identity/requireMember";
import { convexCopyRepository } from "./adapters/convexCopyRepository";
import { noopEventPublisher } from "./adapters/eventPublisher";
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
      events: noopEventPublisher(ctx),
      clock: systemClock,
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
