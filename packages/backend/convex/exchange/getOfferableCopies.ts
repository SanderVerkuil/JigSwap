import { isLentOut, mayOfferCopy, toMemberId } from "@jigswap/domain";
import { v } from "convex/values";
import type { Id } from "../_generated/dataModel";
import { query } from "../_generated/server";
import { ownerHouseholdOf } from "../household/copyAccess";
import { personView } from "../household/getMyHousehold";
import { householdMateIds } from "../household/memberships";
import { requireMember } from "../identity/requireMember";
import { canViewCopy } from "../library/canViewCopy";
import { toCopyPuzzleView } from "../library/mappers";
import {
  LIBRARY_INDEX_CAP,
  LIBRARY_WINDOW_MAX,
  newestCopiesOf,
} from "../library/myLibraryRows";
import { resolveCopyCoverUrl } from "../library/resolveCoverUrl";
import { blockedEitherWaySet } from "../social/blocks";
import { toCopyView } from "./adapters/convexCopyPort";

// Exchange read: the copies the viewer could offer in a swap for `requestedPuzzleId`. Candidates
// are the viewer's own copies plus their household mates' copies; each is filtered through the
// SAME domain rules propose applies to the offered copy (`mayOfferCopy`, and `isLentOut`: a copy out
// on loan can't be offered, over the same CopyPort view: toCopyView over the owner's household
// facts), so the list never offers a copy propose would reject. Empty when the requested copy is
// missing or not viewable — the query must not confirm a hidden copy exists. Bounded like the
// other pickers: the newest LIBRARY_WINDOW_MAX offerable copies, filtered from the owners' newest
// LIBRARY_INDEX_CAP lean rows so a mate's copies the viewer may not offer can't crowd theirs out.
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

    // A housemate blocked either way with the viewer has no copy they may offer: leave their rows
    // out of the LIBRARY_INDEX_CAP read.
    const blocked = await blockedEitherWaySet(ctx, viewerId);
    const ownerIds = [
      viewerId,
      ...[...(await householdMateIds(ctx, viewerId))].filter(
        (id) => !blocked.has(id),
      ),
    ];
    // The household facts are per OWNER: resolved once here, not per copy. Each copy's CopyView
    // carries the co-managers and owner blocks the CopyPort would report for it.
    const households = new Map(
      await Promise.all(
        ownerIds.map(
          async (ownerId) =>
            [ownerId, await ownerHouseholdOf(ctx, ownerId)] as const,
        ),
      ),
    );
    const copies = (await newestCopiesOf(ctx, ownerIds, LIBRARY_INDEX_CAP))
      .filter((copy) => {
        const household = households.get(copy.ownerId) ?? null;
        const view = toCopyView(copy, household);
        return mayOfferCopy(view, viewer, recipient) && !isLentOut(view);
      })
      .slice(0, LIBRARY_WINDOW_MAX);
    const rows = [];
    for (const ownerId of ownerIds) {
      const owned = copies.filter((copy) => copy.ownerId === ownerId);
      if (owned.length === 0) continue;
      const ownedByViewer = ownerId === viewerId;
      // The co-owning household mate, so the picker can say whose copy it is.
      const owner = ownedByViewer ? null : await personView(ctx, ownerId);
      for (const copy of owned) {
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
