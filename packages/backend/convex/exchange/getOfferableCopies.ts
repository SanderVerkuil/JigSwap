import { isLentOut, mayOfferCopy, toMemberId } from "@jigswap/domain";
import { v } from "convex/values";
import type { Id } from "../_generated/dataModel";
import { query } from "../_generated/server";
import { coManagerIdsFrom, ownerHouseholdOf } from "../household/copyAccess";
import { personView } from "../household/getMyHousehold";
import { householdMateIds } from "../household/memberships";
import { requireMember } from "../identity/requireMember";
import { canViewCopy } from "../library/canViewCopy";
import { toCopyPuzzleView } from "../library/mappers";
import { LIBRARY_WINDOW_MAX, newestCopiesOf } from "../library/myLibraryRows";
import { resolveCopyCoverUrl } from "../library/resolveCoverUrl";
import { toCopyView } from "./adapters/convexCopyPort";

// Exchange read: the copies the viewer could offer in a swap for `requestedPuzzleId`. Candidates
// are the viewer's own copies plus their household mates' copies; each is filtered through the
// SAME domain rules propose applies to the offered copy (`mayOfferCopy`, and `isLentOut`: a copy out
// on loan can't be offered, over the same CopyPort view: toCopyView + the co-manager rule
// coManagerIdsFrom), so the list never offers a copy propose would reject. Empty when the requested
// copy is missing or not viewable — the query must not confirm a hidden copy exists. Bounded: the
// newest LIBRARY_WINDOW_MAX copies of those owners, like the other pickers.
export const getOfferableCopies = query({
  args: { requestedPuzzleId: v.id("ownedPuzzles") },
  handler: async (ctx, args) => {
    const viewer = await requireMember(ctx);
    const viewerId = viewer as unknown as Id<"users">;

    const requested = await ctx.db.get(args.requestedPuzzleId);
    if (!requested || !(await canViewCopy(ctx, viewerId, requested))) {
      return [];
    }
    const recipient = toMemberId(requested.ownerId);

    const ownerIds = [viewerId, ...(await householdMateIds(ctx, viewerId))];
    const copies = await newestCopiesOf(ctx, ownerIds, LIBRARY_WINDOW_MAX);
    const rows = [];
    for (const ownerId of ownerIds) {
      const owned = copies.filter((copy) => copy.ownerId === ownerId);
      if (owned.length === 0) continue;
      // The co-management facts and the owner label are per OWNER: resolved once here, not per
      // copy. Each copy's CopyView carries the co-managers the CopyPort would report for it.
      const household = await ownerHouseholdOf(ctx, ownerId);
      const ownedByViewer = ownerId === viewerId;
      // The co-owning household mate, so the picker can say whose copy it is.
      const owner = ownedByViewer ? null : await personView(ctx, ownerId);
      for (const copy of owned) {
        const view = toCopyView(copy, coManagerIdsFrom(copy, household));
        if (!mayOfferCopy(view, viewer, recipient) || isLentOut(view)) continue;
        const puzzle = await ctx.db.get(copy.puzzleId);
        // Whoever may offer it manages it: the facts My Puzzles shows them (SEC-34), which for a
        // definition they may not read are the copy's own snapshot, never its live title.
        const facts = toCopyPuzzleView(copy, puzzle, {
          includeOwnerOnly: true,
        });
        rows.push({
          _id: copy._id as string,
          title: facts?.title ?? copy.snapshot?.title ?? "",
          brand: facts?.brand ?? copy.snapshot?.brand,
          pieceCount: facts?.pieceCount ?? copy.snapshot?.pieceCount ?? 0,
          condition: copy.condition,
          coverUrl: await resolveCopyCoverUrl(ctx, copy, puzzle),
          ownedByViewer,
          owner,
          createdAt: copy.createdAt,
        });
      }
    }
    return rows.sort((a, b) => b.createdAt - a.createdAt);
  },
});
