import type { Id } from "../_generated/dataModel";
import { query } from "../_generated/server";
import { requireMember } from "../identity/requireMember";
import { LIBRARY_INDEX_CAP } from "./myLibraryRows";

// Library read: which catalogue definitions the signed-in member already has a copy of, so the add
// flows can mark a puzzle as on their shelf. Reads the member's copy rows and nothing they join; ids
// are the definitions' aggregateIds, deduped. Newest copies first, at most LIBRARY_INDEX_CAP.
export const listMyOwnedDefinitionIds = query({
  args: {},
  handler: async (ctx): Promise<string[]> => {
    const me = (await requireMember(ctx)) as unknown as Id<"users">;
    const copies = await ctx.db
      .query("ownedPuzzles")
      .withIndex("by_owner", (q) => q.eq("ownerId", me))
      .order("desc")
      .take(LIBRARY_INDEX_CAP);
    return [
      ...new Set(
        copies.flatMap((copy) =>
          copy.puzzleDefinitionId ? [copy.puzzleDefinitionId] : [],
        ),
      ),
    ];
  },
});
