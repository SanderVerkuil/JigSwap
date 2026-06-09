import { v } from "convex/values";
import type { Doc, Id } from "../_generated/dataModel";
import { query, type QueryCtx } from "../_generated/server";
import { requireMember } from "../identity/requireMember";

// Read side for a puzzle's/copy's solve history: the acting member's completions of a given
// puzzle definition OR a given owned copy, newest first. The arg is a domain aggregateId
// (string); resolve it to the stored FK `_id` (legacy `_id` fallback) before querying. Auth-gated;
// photo storage ids are resolved to URLs.
export const getCompletionHistory = query({
  args: {
    puzzleDefinitionId: v.optional(v.string()),
    copyId: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const memberId = await requireMember(ctx);
    const userId = memberId as unknown as Id<"users">;

    let rows: Doc<"completions">[];
    if (args.copyId) {
      const ownedPuzzleId = await resolveCopyId(ctx, args.copyId);
      rows = ownedPuzzleId
        ? await ctx.db
            .query("completions")
            .withIndex("by_user_owned_puzzle", (q) =>
              q.eq("userId", userId).eq("ownedPuzzleId", ownedPuzzleId),
            )
            .order("desc")
            .collect()
        : [];
    } else if (args.puzzleDefinitionId) {
      const puzzleId = await resolvePuzzleId(ctx, args.puzzleDefinitionId);
      rows = puzzleId
        ? await ctx.db
            .query("completions")
            .withIndex("by_user_puzzle", (q) =>
              q.eq("userId", userId).eq("puzzleId", puzzleId),
            )
            .order("desc")
            .collect()
        : [];
    } else {
      rows = [];
    }

    return Promise.all(
      rows.map(async (row) => ({
        ...row,
        photoUrls: await Promise.all(
          row.photos.map((fileId) => ctx.storage.getUrl(fileId)),
        ),
      })),
    );
  },
});

// Resolve a Catalog PuzzleDefinitionId aggregateId to the stored `puzzles._id` (legacy fallback).
const resolvePuzzleId = async (
  ctx: QueryCtx,
  aggregateId: string,
): Promise<Id<"puzzles">> => {
  const row = await ctx.db
    .query("puzzles")
    .withIndex("by_aggregate_id", (q) => q.eq("aggregateId", aggregateId))
    .unique();
  return row?._id ?? (aggregateId as Id<"puzzles">);
};

// Resolve a Library CopyId aggregateId to the stored `ownedPuzzles._id` (legacy fallback).
const resolveCopyId = async (
  ctx: QueryCtx,
  aggregateId: string,
): Promise<Id<"ownedPuzzles">> => {
  const row = await ctx.db
    .query("ownedPuzzles")
    .withIndex("by_aggregate_id", (q) => q.eq("aggregateId", aggregateId))
    .unique();
  return row?._id ?? (aggregateId as Id<"ownedPuzzles">);
};
