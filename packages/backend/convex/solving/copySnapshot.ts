import type { Doc } from "../_generated/dataModel";
import type { MutationCtx } from "../_generated/server";

// Denormalize the durable puzzleId anchor + copy snapshot onto a just-written completion row.
// Library-context data the Solving domain never loads, so the composition roots (record + start)
// write it after the use case persists. Survives copy deletion; the live ownedPuzzleId may go stale.
// No-op if the row is missing — cannot happen when called after a successful save; a miss would
// indicate a repository/id-generator bug.
export const denormalizeCopyOntoCompletion = async (
  ctx: MutationCtx,
  completionId: string,
  copy: Doc<"ownedPuzzles">,
  copyAggregateId: string,
  loggerId: string,
): Promise<void> => {
  const row = await ctx.db
    .query("completions")
    .withIndex("by_aggregate_id", (q) => q.eq("aggregateId", completionId))
    .unique();
  if (!row) return;
  await ctx.db.patch(row._id, {
    puzzleId: row.puzzleId ?? copy.puzzleId,
    copySnapshot: {
      copyId: copyAggregateId,
      ownerId: copy.ownerId,
      wasBorrowed: copy.ownerId !== loggerId,
      condition: copy.condition,
      missingPiecesCount: copy.missingPiecesCount,
      title: copy.snapshot?.title,
      brand: copy.snapshot?.brand,
      pieceCount: copy.snapshot?.pieceCount,
    },
  });
};
