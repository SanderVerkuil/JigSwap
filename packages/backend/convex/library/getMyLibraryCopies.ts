import type { MyLibraryCopyView } from "@jigswap/contracts";
import { v } from "convex/values";
import type { Doc, Id } from "../_generated/dataModel";
import { query } from "../_generated/server";
import { requireMember } from "../identity/requireMember";
import {
  LIBRARY_WINDOW_MAX,
  libraryScopeOf,
  toMyLibraryCopyViews,
} from "./myLibraryRows";

// Library read: the full rows of the given copies, in the order asked for, for what My Puzzles shows
// of a search, sort or status pill worked out over library.myLibraryIndex. The ids come from the
// client, so each copy is checked: only the viewer's own and their housemates' come back, and any
// other id reads as if the copy did not exist, as does a deleted one. At most LIBRARY_WINDOW_MAX ids,
// repeats counted once.
export const getMyLibraryCopies = query({
  args: { copyIds: v.array(v.id("ownedPuzzles")) },
  handler: async (ctx, args): Promise<MyLibraryCopyView[]> => {
    const viewerId = (await requireMember(ctx)) as unknown as Id<"users">;
    const scope = await libraryScopeOf(ctx, viewerId);
    const ids = [...new Set(args.copyIds)].slice(0, LIBRARY_WINDOW_MAX);
    const copies = await Promise.all(ids.map((id) => ctx.db.get(id)));
    const inScope = copies.filter(
      (copy): copy is Doc<"ownedPuzzles"> =>
        copy !== null &&
        (copy.ownerId === viewerId || scope.mates.has(copy.ownerId)),
    );
    return toMyLibraryCopyViews(ctx, inScope, scope);
  },
});
