import type { PuzzleDefinitionView } from "@jigswap/contracts";
import { v } from "convex/values";
import { query } from "../_generated/server";
import { toPuzzleDefinitionView } from "./mappers";

// Catalog read: a single puzzle definition by Convex id, with its box-art URL resolved. Returns a
// typed DTO instead of the raw row; behaviour-preserving vs legacy puzzles.getPuzzleById.
export const getPuzzleById = query({
  args: { puzzleId: v.id("puzzles") },
  handler: async (ctx, args): Promise<PuzzleDefinitionView | null> => {
    const puzzle = await ctx.db.get(args.puzzleId);
    if (!puzzle) return null;
    const image = puzzle.image ? await ctx.storage.getUrl(puzzle.image) : null;
    return toPuzzleDefinitionView(puzzle, image);
  },
});
