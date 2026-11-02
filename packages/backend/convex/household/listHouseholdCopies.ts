import type { HouseholdCopyView } from "@jigswap/contracts";
import type { Id } from "../_generated/dataModel";
import { query } from "../_generated/server";
import { requireMember } from "../identity/requireMember";
import {
  LIBRARY_INDEX_CAP,
  libraryScopeOf,
  newestCopiesOf,
  toMyLibraryCopyViews,
} from "../library/myLibraryRows";

// The OTHER household members' copies, for "Log a completion"'s picker, which offers every copy the
// member may log a solve for. My Puzzles and the household's Puzzles tab page instead
// (library/listMyLibraryWindow). Every household copy is listed regardless of availability (the
// household rule of canViewCopy), tagged with its owner and the viewer's access. Owner-only fields
// are included only for "manage" (co-owner) access. Empty when the viewer is in no household. Newest
// first, at most LIBRARY_INDEX_CAP.
export const listHouseholdCopies = query({
  args: {},
  handler: async (ctx): Promise<HouseholdCopyView[]> => {
    const viewerId = (await requireMember(ctx)) as unknown as Id<"users">;
    const scope = await libraryScopeOf(ctx, viewerId);
    if (scope.mates.size === 0) return [];
    const copies = await newestCopiesOf(
      ctx,
      [...scope.mates],
      LIBRARY_INDEX_CAP,
    );
    const views = await toMyLibraryCopyViews(ctx, copies, scope);
    return views
      .flatMap((view) =>
        view.household ? [{ ...view, household: view.household }] : [],
      )
      .sort((a, b) => b.createdAt - a.createdAt);
  },
});
