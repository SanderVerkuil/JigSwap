import type { PuzzleSummaryView } from "@jigswap/contracts";
import type { Id } from "../_generated/dataModel";
import { query } from "../_generated/server";
import { requireMember } from "../identity/requireMember";
import { boxArtImage } from "../lib/imageModeration/boxArtUrl";
import { canViewDefinition } from "./definitionVisibility";
import { toPuzzleSummaryView } from "./mappers";

// Catalog read: the acting member's favorited puzzle definitions, newest-favorite first, as the
// same summary DTO the other catalog lists feed the PuzzleCard. Rows whose definition has since
// been deleted, or is no longer one the member may open (canViewDefinition: e.g. disabled or
// rejected since they favorited it), are skipped. Auth-gated to the acting member.
export const listMyFavorites = query({
  args: {},
  handler: async (ctx): Promise<PuzzleSummaryView[]> => {
    const memberId = (await requireMember(ctx)) as unknown as Id<"users">;

    const favorites = await ctx.db
      .query("favorites")
      .withIndex("by_user", (q) => q.eq("userId", memberId))
      .order("desc")
      .collect();

    const views: PuzzleSummaryView[] = [];
    for (const favorite of favorites) {
      const puzzle = await ctx.db.get(favorite.puzzleId);
      if (!puzzle || !(await canViewDefinition(ctx, puzzle, memberId))) {
        continue;
      }
      views.push(
        toPuzzleSummaryView(
          puzzle,
          puzzle.image ? await boxArtImage(ctx, puzzle.image) : null,
        ),
      );
    }
    return views;
  },
});
