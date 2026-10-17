import { mayOfferCopy, toCopyId, toMemberId } from "@jigswap/domain";
import { v } from "convex/values";
import type { Doc, Id } from "../_generated/dataModel";
import { query } from "../_generated/server";
import { personView } from "../household/getMyHousehold";
import { householdMateIds } from "../household/memberships";
import { requireMember } from "../identity/requireMember";
import { canViewCopy } from "../library/canViewCopy";
import { resolveCopyCoverUrl } from "../library/resolveCoverUrl";
import { convexCopyPort } from "./adapters/convexCopyPort";

// Exchange read: the copies the viewer could offer in a swap for `requestedPuzzleId`. Candidates
// are the viewer's own copies plus their household mates' copies; each is filtered through the
// SAME domain rule propose applies to the offered copy (`mayOfferCopy`, over the same CopyPort
// view), so the list never offers a copy propose would reject. Empty when the requested copy is
// missing or not viewable — the query must not confirm a hidden copy exists.
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
    const candidates: Doc<"ownedPuzzles">[] = [];
    for (const ownerId of ownerIds) {
      candidates.push(
        ...(await ctx.db
          .query("ownedPuzzles")
          .withIndex("by_owner", (q) => q.eq("ownerId", ownerId))
          .collect()),
      );
    }

    const copies = convexCopyPort(ctx);
    const rows = [];
    for (const copy of candidates) {
      const view = await copies.getCopy(toCopyId(copy._id));
      if (!view || !mayOfferCopy(view, viewer, recipient)) continue;
      const puzzle = await ctx.db.get(copy.puzzleId);
      const ownedByViewer = copy.ownerId === viewerId;
      rows.push({
        _id: copy._id as string,
        title: puzzle?.title ?? copy.snapshot?.title ?? "",
        brand: puzzle?.brand ?? copy.snapshot?.brand,
        pieceCount: puzzle?.pieceCount ?? copy.snapshot?.pieceCount ?? 0,
        condition: copy.condition,
        coverUrl: await resolveCopyCoverUrl(ctx, copy, puzzle),
        ownedByViewer,
        // The co-owning household mate, so the picker can say whose copy it is.
        owner: ownedByViewer ? null : await personView(ctx, copy.ownerId),
        createdAt: copy.createdAt,
      });
    }
    return rows.sort((a, b) => b.createdAt - a.createdAt);
  },
});
