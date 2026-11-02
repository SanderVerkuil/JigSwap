import {
  LIBRARY_ROWS_MAX,
  type HouseholdPersonView,
  type MyLibraryCopyView,
} from "@jigswap/contracts";
import { resolveHouseholdCopyPermission } from "@jigswap/domain";
import { mergedStream, stream } from "convex-helpers/server/stream";
import type { Doc, Id } from "../_generated/dataModel";
import type { QueryCtx } from "../_generated/server";
import { personView } from "../household/getMyHousehold";
import {
  householdDefaultOf,
  householdMateIds,
  membershipOf,
} from "../household/memberships";
import schema from "../schema";
import { toOwnedCopyView } from "./mappers";
import { resolveCopyCoverFields } from "./resolveCoverUrl";

// The rows My Puzzles and the household's Puzzles tab are built from: the viewer's own copies plus
// their housemates' (library/listMyLibraryWindow, listMyLibraryIndex, getMyLibraryCopies, and the
// household-only household/listHouseholdCopies).

// The most full rows one read joins, My Puzzles' deepest scroll and the pickers alike. Each costs up
// to four index ranges (LIBRARY_ROWS_MAX explains), so more than this can throw instead of truncating.
export const LIBRARY_WINDOW_MAX = LIBRARY_ROWS_MAX;

// The most copies a lean read over the whole library covers, newest first: one index row each plus
// at most its puzzle. No real member comes close; past it the oldest copies drop out of search, sort
// and Select all rather than the read failing.
export const LIBRARY_INDEX_CAP = 3000;

/** Who the viewer's library spans, and what they may do with a housemate's copy. */
export interface LibraryScope {
  viewerId: Id<"users">;
  mates: ReadonlySet<Id<"users">>;
  householdDefault: Doc<"households">["defaultCopyPermission"];
}

export const libraryScopeOf = async (
  ctx: QueryCtx,
  viewerId: Id<"users">,
): Promise<LibraryScope> => {
  const mates = await householdMateIds(ctx, viewerId);
  const membership = await membershipOf(ctx, viewerId);
  return {
    viewerId,
    mates,
    // Every mate shares the viewer's household, so one default applies to all their copies.
    householdDefault: membership
      ? await householdDefaultOf(ctx, membership.householdId)
      : undefined,
  };
};

/** The viewer's access to a housemate's copy; undefined on their own copy. */
export const viewerAccessOf = (
  copy: Pick<Doc<"ownedPuzzles">, "ownerId" | "householdPermission">,
  scope: LibraryScope,
) =>
  copy.ownerId === scope.viewerId
    ? undefined
    : resolveHouseholdCopyPermission(
        copy.householdPermission,
        scope.householdDefault,
      );

/** The owners' copies merged newest first (by_owner ends in _creationTime), at most `count`. */
export const newestCopiesOf = (
  ctx: QueryCtx,
  owners: readonly Id<"users">[],
  count: number,
): Promise<Doc<"ownedPuzzles">[]> =>
  mergedStream(
    owners.map((ownerId) =>
      stream(ctx.db, schema)
        .query("ownedPuzzles")
        .withIndex("by_owner", (q) => q.eq("ownerId", ownerId))
        .order("desc"),
    ),
    ["_creationTime"],
  ).take(count);

/**
 * Full card rows for copies the caller has already established are in `scope`. Owner-only fields go
 * out on the viewer's own copies and on a housemate's left at "manage" (the household rule of
 * canViewCopy); a housemate's copy is tagged with its owner and the viewer's access.
 */
export const toMyLibraryCopyViews = (
  ctx: QueryCtx,
  copies: readonly Doc<"ownedPuzzles">[],
  scope: LibraryScope,
): Promise<MyLibraryCopyView[]> => {
  const owners = new Map<Id<"users">, Promise<HouseholdPersonView>>();
  const ownerView = (ownerId: Id<"users">) => {
    const known = owners.get(ownerId);
    if (known) return known;
    const view = personView(ctx, ownerId);
    owners.set(ownerId, view);
    return view;
  };
  return Promise.all(
    copies.map(async (copy): Promise<MyLibraryCopyView> => {
      const viewerAccess = viewerAccessOf(copy, scope);
      const puzzle = await ctx.db.get(copy.puzzleId);
      const view = toOwnedCopyView(copy, puzzle, {
        ...(await resolveCopyCoverFields(ctx, copy, puzzle)),
        includeOwnerOnly: viewerAccess !== "view",
      });
      if (viewerAccess === undefined) return view;
      return {
        ...view,
        household: { owner: await ownerView(copy.ownerId), viewerAccess },
      };
    }),
  );
};
