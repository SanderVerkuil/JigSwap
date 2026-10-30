import type { PuzzleDefinitionView } from "@jigswap/contracts";
import { v } from "convex/values";
import { query } from "../_generated/server";
import { boxArtUrl } from "../lib/imageModeration/boxArtUrl";
import { canViewDefinition } from "./definitionVisibility";
import { toPuzzleDefinitionView } from "./mappers";

// Catalog read: a single puzzle definition by Convex id, with its box-art URL resolved. Returns a
// typed DTO instead of the raw row.
//
// Moderation gate (mirrors every sibling catalog read, which filters `status === "approved"`):
// a definition is only disclosed when it is APPROVED, OR the caller is its submitter, OR the caller
// is an admin (canViewDefinition, the gate shared with the library definition view). This closes a
// by-id leak of pending/rejected definitions while preserving the legitimate add/new.tsx
// `?puzzleId=` flow where a submitter pre-fills from their own (possibly still pending)
// submission. Unauthenticated reads of approved definitions are unchanged.
export const getPuzzleById = query({
  args: { puzzleId: v.id("puzzles") },
  handler: async (ctx, args): Promise<PuzzleDefinitionView | null> => {
    const puzzle = await ctx.db.get(args.puzzleId);
    if (!puzzle) return null;

    if (!(await canViewDefinition(ctx, puzzle))) return null;

    const image = puzzle.image ? await boxArtUrl(ctx, puzzle.image) : null;
    return toPuzzleDefinitionView(puzzle, image);
  },
});
