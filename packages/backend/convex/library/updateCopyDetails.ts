import {
  makeUpdateCopyDetails,
  toCopyId,
  type AcquisitionSource,
  type OwnerId,
} from "@jigswap/domain";
import { v } from "convex/values";
import { mutation } from "../_generated/server";
import { convexCopyManagerPolicy } from "../household/copyAccess";
import { requireMember } from "../identity/requireMember";
import { convexCopyRepository } from "./adapters/convexCopyRepository";
import { libraryEventPublisher } from "./adapters/eventPublisher";
import { systemClock } from "./adapters/systemClock";
import { toConvexError } from "./errors";

// Composition root for patching a copy's descriptive fields (missing-piece count, notes, and when
// and how it was acquired). `copyId` is the domain aggregateId; omitted fields are left unchanged.
// A supplied `acquisition` replaces the date (epoch millis) and source together, so leaving one out
// clears it; the acquisition price is kept. A date that isn't possible is refused by the domain.
// Only someone who may manage the copy may patch it.
export const updateCopyDetails = mutation({
  args: {
    copyId: v.string(),
    missingPiecesCount: v.optional(v.number()),
    notes: v.optional(v.string()),
    acquisition: v.optional(
      v.object({
        date: v.optional(v.number()),
        source: v.optional(
          v.union(
            v.literal("bought_new"),
            v.literal("bought_used"),
            v.literal("trade"),
            v.literal("gift"),
          ),
        ),
      }),
    ),
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
      acquisition: args.acquisition && {
        date:
          args.acquisition.date === undefined
            ? undefined
            : new Date(args.acquisition.date),
        source: args.acquisition.source as AcquisitionSource | undefined,
      },
    });
    if (result.isErr) throw toConvexError(result.error);
  },
});
