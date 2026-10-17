import type { HouseholdCopyView } from "@jigswap/contracts";
import type { Id } from "../_generated/dataModel";
import { query } from "../_generated/server";
import { requireMember } from "../identity/requireMember";
import { toOwnedCopyView } from "../library/mappers";
import { resolveCopyCoverUrl } from "../library/resolveCoverUrl";
import { personView } from "./getMyHousehold";
import { householdMateIds } from "./memberships";

// The OTHER household members' copies, for the viewer's "My puzzles". Every household copy is
// listed regardless of availability (the household rule of canViewCopy), tagged with its owner and
// the viewer's access. Owner-only fields are included only for "manage" (co-owner) access. Empty
// when the viewer is in no household. Newest first, like the owner's own list.
export const listHouseholdCopies = query({
  args: {},
  handler: async (ctx): Promise<HouseholdCopyView[]> => {
    const viewerId = (await requireMember(ctx)) as unknown as Id<"users">;
    const mates = await householdMateIds(ctx, viewerId);

    const views: HouseholdCopyView[] = [];
    for (const mateId of mates) {
      const owner = await personView(ctx, mateId);
      const copies = await ctx.db
        .query("ownedPuzzles")
        .withIndex("by_owner", (q) => q.eq("ownerId", mateId))
        .collect();
      for (const copy of copies) {
        const viewerAccess = copy.householdPermission ?? "manage";
        const puzzle = await ctx.db.get(copy.puzzleId);
        views.push({
          ...toOwnedCopyView(copy, puzzle, {
            coverUrl: await resolveCopyCoverUrl(ctx, copy, puzzle),
            includeOwnerOnly: viewerAccess === "manage",
          }),
          household: { owner, viewerAccess },
        });
      }
    }
    return views.sort((a, b) => b.createdAt - a.createdAt);
  },
});
