import type { MyLibraryIndexRow } from "@jigswap/contracts";
import type { Doc, Id } from "../_generated/dataModel";
import { query } from "../_generated/server";
import { requireMember } from "../identity/requireMember";
import { effectiveCopyVisibility } from "./copyVisibility";
import { toCopyPuzzleView, toCopySnapshotView } from "./mappers";
import {
  LIBRARY_INDEX_CAP,
  libraryScopeOf,
  newestCopiesOf,
  viewerAccessOf,
} from "./myLibraryRows";

// Library read: one lean row per copy of the viewer's library (their own plus their housemates',
// newest first, at most LIBRARY_INDEX_CAP), for what only the whole library can answer: search, sort
// and the status pills, and Select all. The web filters and sorts these in the member's locale and
// asks library.myLibraryCopies for the full rows of just what's on screen, so covers, notes and the
// rest are never read for the whole library. It only runs while one of those is in use: the plain
// list reads library.myLibraryWindow. It still reads every copy and its puzzle, because a copy's
// title, brand and tags live on the puzzle and no index can search or sort them per member.
export const listMyLibraryIndex = query({
  args: {},
  handler: async (ctx): Promise<MyLibraryIndexRow[]> => {
    const viewerId = (await requireMember(ctx)) as unknown as Id<"users">;
    const scope = await libraryScopeOf(ctx, viewerId);
    const copies = await newestCopiesOf(
      ctx,
      [viewerId, ...scope.mates],
      LIBRARY_INDEX_CAP,
    );

    const puzzles = new Map<Id<"puzzles">, Promise<Doc<"puzzles"> | null>>();
    const puzzleOf = (id: Id<"puzzles">) => {
      const known = puzzles.get(id);
      if (known) return known;
      const puzzle = ctx.db.get(id);
      puzzles.set(id, puzzle);
      return puzzle;
    };

    return Promise.all(
      copies.map(async (copy): Promise<MyLibraryIndexRow> => {
        const viewerAccess = viewerAccessOf(copy, scope);
        // The same gate as the full row: a housemate's copy left at "view" of a definition that is
        // not approved shows only its snapshot facts.
        const puzzle = toCopyPuzzleView(copy, await puzzleOf(copy.puzzleId), {
          includeOwnerOnly: viewerAccess !== "view",
        });
        return {
          _id: copy._id,
          aggregateId: copy.aggregateId,
          ownerId: copy.ownerId,
          createdAt: copy.createdAt,
          availability: copy.availability,
          visibility: effectiveCopyVisibility(copy),
          snapshot: toCopySnapshotView(copy.snapshot),
          puzzle: puzzle && {
            title: puzzle.title,
            brand: puzzle.brand,
            pieceCount: puzzle.pieceCount,
            tags: puzzle.tags,
          },
          ...(viewerAccess !== undefined && { viewerAccess }),
        };
      }),
    );
  },
});
