import type { PuzzleDefinitionView } from "@jigswap/contracts";
import { v } from "convex/values";
import type { Id } from "../_generated/dataModel";
import { query, type QueryCtx } from "../_generated/server";
import { isAdmin } from "../identity/isAdmin";
import { toPuzzleDefinitionView } from "./mappers";

// Resolve the acting member from auth WITHOUT throwing (unlike requireMember): an unauthenticated
// caller, or one whose Clerk subject has no user row, simply yields null. Used only to decide
// whether a NON-approved definition may be disclosed to its submitter.
const optionalActingMember = async (
  ctx: QueryCtx,
): Promise<Id<"users"> | null> => {
  const identity = await ctx.auth.getUserIdentity();
  if (!identity) return null;
  const user = await ctx.db
    .query("users")
    .withIndex("by_clerk_id", (q) => q.eq("clerkId", identity.subject))
    .unique();
  return user?._id ?? null;
};

// Catalog read: a single puzzle definition by Convex id, with its box-art URL resolved. Returns a
// typed DTO instead of the raw row.
//
// Moderation gate (mirrors every sibling catalog read, which filters `status === "approved"`):
// a definition is only disclosed when it is APPROVED, OR the caller is its submitter, OR the caller
// is an admin. This closes a by-id leak of pending/rejected definitions while preserving the
// legitimate add/new.tsx `?puzzleId=` flow where a submitter pre-fills from their own (possibly
// still pending) submission. Unauthenticated reads of approved definitions are unchanged.
export const getPuzzleById = query({
  args: { puzzleId: v.id("puzzles") },
  handler: async (ctx, args): Promise<PuzzleDefinitionView | null> => {
    const puzzle = await ctx.db.get(args.puzzleId);
    if (!puzzle) return null;

    if (puzzle.status !== "approved") {
      const actingMember = await optionalActingMember(ctx);
      const isSubmitter =
        actingMember !== null && puzzle.submittedBy === actingMember;
      if (!isSubmitter && !(await isAdmin(ctx))) return null;
    }

    const image = puzzle.image ? await ctx.storage.getUrl(puzzle.image) : null;
    return toPuzzleDefinitionView(puzzle, image);
  },
});
