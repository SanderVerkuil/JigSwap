import type { Doc, Id } from "../../_generated/dataModel";
import type { MutationCtx, QueryCtx } from "../../_generated/server";

// Everything that holds a box-art blob: the definitions whose `image` it is, and the change
// proposals that propose it (`changes.image`) or recorded it as the definition's image when they
// were made (`baseline.image`, found through those definitions).

export type BoxArtHolders = {
  definitions: Doc<"puzzles">[];
  proposals: Doc<"puzzleChangeProposals">[];
};

export const boxArtHolders = async (
  ctx: QueryCtx,
  blob: Id<"_storage">,
): Promise<BoxArtHolders> => {
  const definitions = await ctx.db
    .query("puzzles")
    .withIndex("by_image", (q) => q.eq("image", blob))
    .collect();
  const proposals = await ctx.db
    .query("puzzleChangeProposals")
    .withIndex("by_changes_image", (q) => q.eq("changes.image", blob))
    .collect();
  for (const definition of definitions) {
    const aggregateId = definition.aggregateId;
    if (!aggregateId) continue;
    const ofDefinition = await ctx.db
      .query("puzzleChangeProposals")
      .withIndex("by_definition", (q) =>
        q.eq("puzzleDefinitionId", aggregateId),
      )
      .collect();
    proposals.push(...ofDefinition.filter((p) => p.baseline.image === blob));
  }
  return {
    definitions,
    proposals: [...new Map(proposals.map((p) => [p._id, p])).values()],
  };
};

/**
 * Point every holder of `from` at `to`, or detach `from` everywhere when `to` is undefined (the
 * definition then has no box art, the proposal no longer proposes one).
 */
export const repointBoxArt = async (
  ctx: MutationCtx,
  holders: BoxArtHolders,
  from: Id<"_storage">,
  to: Id<"_storage"> | undefined,
): Promise<void> => {
  for (const definition of holders.definitions) {
    await ctx.db.patch(definition._id, { image: to });
  }
  for (const proposal of holders.proposals) {
    await ctx.db.patch(proposal._id, {
      changes:
        proposal.changes.image === from
          ? { ...proposal.changes, image: to }
          : proposal.changes,
      ...(proposal.baseline.image === from && {
        baseline: { ...proposal.baseline, image: to },
      }),
    });
  }
};

/**
 * A label for box art in the admin console: the title of a definition holding it, else of the
 * definition a proposal holding it is for (the proposed title when it changes the title), else
 * null (the box art is not attached to anything, e.g. a form never saved).
 */
export const boxArtTitle = async (
  ctx: QueryCtx,
  blob: Id<"_storage">,
): Promise<string | null> => {
  const holders = await boxArtHolders(ctx, blob);
  const definition = holders.definitions[0];
  if (definition) return definition.title;
  const proposal = holders.proposals[0];
  if (!proposal) return null;
  if (proposal.changes.title) return proposal.changes.title;
  const proposed = await ctx.db
    .query("puzzles")
    .withIndex("by_aggregate_id", (q) =>
      q.eq("aggregateId", proposal.puzzleDefinitionId),
    )
    .first();
  return proposed?.title ?? null;
};
