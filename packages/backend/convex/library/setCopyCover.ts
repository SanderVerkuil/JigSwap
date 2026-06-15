import { makeSetCopyCover, type OwnerId, toCopyId } from "@jigswap/domain";
import { ConvexError, v } from "convex/values";
import type { Id } from "../_generated/dataModel";
import { mutation } from "../_generated/server";
import { requireMember } from "../identity/requireMember";
import { convexCopyRepository } from "./adapters/convexCopyRepository";
import { noopEventPublisher } from "./adapters/eventPublisher";
import { systemClock } from "./adapters/systemClock";
import { toConvexError } from "./errors";

// Composition root for choosing a copy's cover picture. Keyed by the copy's Convex id so it pairs
// with the gallery (also keyed by `ownedPuzzles._id`). OWNER-ONLY: only the copy's owner may pick
// its cover. When a `coverImageId` is supplied it must be one of THIS copy's own photos — an image
// row whose `ownedPuzzleId` is this copy — else the request is rejected. Passing `coverImageId`
// undefined clears the selection (fall back to the puzzle's global catalogue image).
export const setCopyCover = mutation({
  args: {
    copyId: v.id("ownedPuzzles"),
    coverImageId: v.optional(v.id("ownedPuzzleImages")),
  },
  handler: async (ctx, args) => {
    const memberId = (await requireMember(ctx)) as unknown as Id<"users">;

    const copy = await ctx.db.get(args.copyId);
    if (!copy) throw new ConvexError("Copy not found");
    if (copy.ownerId !== memberId) {
      throw new ConvexError("Only the owner can change this copy's cover");
    }
    if (!copy.aggregateId) {
      throw new ConvexError("Copy is not managed by the library domain");
    }

    // The chosen image, when present, must belong to THIS copy.
    if (args.coverImageId !== undefined) {
      const image = await ctx.db.get(args.coverImageId);
      if (!image || image.ownedPuzzleId !== args.copyId) {
        throw new ConvexError("Image does not belong to this copy");
      }
    }

    const setCover = makeSetCopyCover({
      copies: convexCopyRepository(ctx),
      events: noopEventPublisher(ctx),
      clock: systemClock,
    });

    const result = await setCover({
      actingMemberId: memberId as unknown as OwnerId,
      copyId: toCopyId(copy.aggregateId),
      coverImageId: (args.coverImageId as string | undefined) ?? null,
    });
    if (result.isErr) throw toConvexError(result.error);
  },
});
