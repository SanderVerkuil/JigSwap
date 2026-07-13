import type { Doc } from "../_generated/dataModel";
import type { QueryCtx } from "../_generated/server";

// Read-model helpers shared by the proposal queries. Conflict detection is DERIVED here at
// read time (spec: "Show conflict, admin decides") — never stored, never enforced.

type Fields = Doc<"puzzleChangeProposals">["changes"];

// Key-order-insensitive structural equality. Convex sorts object keys on write while the
// read-time snapshots are built in literal key order, so a naive JSON.stringify would report
// false conflicts on populated nested groups (barcodes). Canonicalise: strip undefined
// members and sort keys recursively before serialising. Arrays intentionally stay
// order-sensitive (tags order is meaningful).
const canonical = (value: unknown): unknown =>
  value !== null && typeof value === "object" && !Array.isArray(value)
    ? Object.fromEntries(
        Object.entries(value as Record<string, unknown>)
          .filter(([, member]) => member !== undefined)
          .sort(([a], [b]) => a.localeCompare(b))
          .map(([key, member]) => [key, canonical(member)]),
      )
    : value;

const same = (a: unknown, b: unknown): boolean =>
  JSON.stringify(canonical(a) ?? null) === JSON.stringify(canonical(b) ?? null);

// Snapshot the definition row's CURRENT values in the proposal field shape, for exactly the
// fields the diff touches — the review UI's "current → proposed" left-hand side. `category` is
// resolved back to its aggregate id so it compares against the domain-shaped stored columns.
export const currentFieldsFor = async (
  ctx: QueryCtx,
  puzzle: Doc<"puzzles">,
  changes: Fields,
): Promise<Fields> => {
  let category: string | undefined;
  if (changes.category !== undefined && puzzle.category) {
    const row = await ctx.db.get(puzzle.category);
    category = row?.aggregateId ?? (puzzle.category as string);
  }
  return {
    title: changes.title !== undefined ? puzzle.title : undefined,
    description:
      changes.description !== undefined ? puzzle.description : undefined,
    brand: changes.brand !== undefined ? puzzle.brand : undefined,
    publisher: changes.publisher !== undefined ? puzzle.publisher : undefined,
    pieceCount:
      changes.pieceCount !== undefined ? puzzle.pieceCount : undefined,
    artist: changes.artist !== undefined ? puzzle.artist : undefined,
    series: changes.series !== undefined ? puzzle.series : undefined,
    barcodes:
      changes.barcodes !== undefined
        ? { ean: puzzle.ean, upc: puzzle.upc, modelNumber: puzzle.modelNumber }
        : undefined,
    dimensions:
      changes.dimensions !== undefined ? puzzle.dimensions : undefined,
    shape: changes.shape !== undefined ? puzzle.shape : undefined,
    difficulty:
      changes.difficulty !== undefined ? puzzle.difficulty : undefined,
    category: changes.category !== undefined ? category : undefined,
    tags: changes.tags !== undefined ? puzzle.tags : undefined,
    image:
      changes.image !== undefined
        ? (puzzle.image as string | undefined)
        : undefined,
  };
};

// The changed fields whose CURRENT value no longer matches the proposal's baseline — i.e. the
// definition moved (another approved proposal, a direct edit) since the proposer looked at it.
export const conflictFields = (
  changes: Fields,
  baseline: Fields,
  current: Fields,
): string[] =>
  (Object.keys(changes) as (keyof Fields)[])
    .filter((key) => changes[key] !== undefined)
    .filter((key) => !same(baseline[key], current[key]))
    .map((key) => key as string);

// Enrich a proposal row for admin/member lists: definition context, proposer name, current
// values + conflicts, resolved image URLs for review rendering.
export const enrichProposal = async (
  ctx: QueryCtx,
  proposal: Doc<"puzzleChangeProposals">,
) => {
  const puzzle = await ctx.db
    .query("puzzles")
    .withIndex("by_aggregate_id", (q) =>
      q.eq("aggregateId", proposal.puzzleDefinitionId),
    )
    .unique();
  const proposer = await ctx.db.get(proposal.proposedBy);

  const current = puzzle
    ? await currentFieldsFor(ctx, puzzle, proposal.changes)
    : ({} as Doc<"puzzleChangeProposals">["changes"]);
  const conflicts = puzzle
    ? conflictFields(proposal.changes, proposal.baseline, current)
    : [];

  return {
    ...proposal,
    puzzleId: puzzle?._id,
    definitionTitle: puzzle?.title,
    definitionImage: puzzle?.image
      ? await ctx.storage.getUrl(puzzle.image)
      : undefined,
    proposerName: proposer?.name,
    current,
    conflictFields: conflicts,
    hasConflict: conflicts.length > 0,
    proposedImageUrl: proposal.changes.image
      ? await ctx.storage.getUrl(
          proposal.changes.image as Parameters<typeof ctx.storage.getUrl>[0],
        )
      : undefined,
  };
};
