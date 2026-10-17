import type { HouseholdOwnCopyView } from "@jigswap/contracts";
import { resolveHouseholdCopyPermission } from "@jigswap/domain";
import type { Id } from "../_generated/dataModel";
import { query } from "../_generated/server";
import { requireMember } from "../identity/requireMember";
import { toOwnedCopyView } from "../library/mappers";
import { resolveCopyCoverUrl } from "../library/resolveCoverUrl";
import { membershipOf } from "./memberships";

// The viewer's OWN copies with the household permission each currently grants (absent on the row
// = "manage"), for the household page's bulk editor. Empty when the viewer is in no household.
// Not paginated, like the other owner-library reads (getOwnedPuzzlesByOwner, listHouseholdCopies).
// Newest first.
export const listMyHouseholdCopyPermissions = query({
  args: {},
  handler: async (ctx): Promise<HouseholdOwnCopyView[]> => {
    const viewerId = (await requireMember(ctx)) as unknown as Id<"users">;
    if (!(await membershipOf(ctx, viewerId))) return [];

    const copies = await ctx.db
      .query("ownedPuzzles")
      .withIndex("by_owner", (q) => q.eq("ownerId", viewerId))
      .collect();
    const views = await Promise.all(
      copies.map(async (copy) => {
        const puzzle = await ctx.db.get(copy.puzzleId);
        return {
          ...toOwnedCopyView(copy, puzzle, {
            coverUrl: await resolveCopyCoverUrl(ctx, copy, puzzle),
            includeOwnerOnly: true,
          }),
          householdPermission: resolveHouseholdCopyPermission(
            copy.householdPermission,
          ),
        };
      }),
    );
    return views.sort((a, b) => b.createdAt - a.createdAt);
  },
});
