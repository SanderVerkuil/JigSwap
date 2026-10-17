import { paginationOptsValidator } from "convex/server";
import { v } from "convex/values";
import type { Id } from "../_generated/dataModel";
import { query } from "../_generated/server";
import { requireMember } from "../identity/requireMember";
import {
  buildCopyViewContext,
  canViewCopyWithContext,
  type CopyViewContext,
} from "../library/canViewCopy";
import { toPublicCopyView } from "../library/mappers";
import { resolveCopyCoverUrl } from "../library/resolveCoverUrl";
import { canSeeProfileContent } from "./privacy";

// Social read: a member's puzzles (owned copies) for their profile page, newest first, paginated.
// Auth-gated. Two gates, in order:
//   1. Profile unlock (canSeeProfileContent): self, public profile, or mutual follower — otherwise
//      an empty, finished page (same shape, nothing leaked).
//   2. Per-copy reachability (canViewCopyWithContext), exactly as Browse / copy detail.
// Rows are the PUBLIC copy projection for every viewer, the owner included: this is the
// visitor-facing profile, so owner-only keys (notes / acquisition provenance) are never present.
//
// For a non-owner, the page is pre-filtered in the index scan to the only copies canViewCopy can
// ever pass (open, or currently held by the viewer) so pages stay full; a page can still come back
// short when the owner's profile is private and only circle-shared copies survive the gate.
export const listProfileCopies = query({
  args: { memberId: v.id("users"), paginationOpts: paginationOptsValidator },
  handler: async (ctx, args) => {
    const viewerId = (await requireMember(ctx)) as unknown as Id<"users">;
    if (!(await canSeeProfileContent(ctx, viewerId, args.memberId))) {
      return { page: [], isDone: true, continueCursor: "" };
    }
    const isOwner = viewerId === args.memberId;

    const base = ctx.db
      .query("ownedPuzzles")
      .withIndex("by_owner", (q) => q.eq("ownerId", args.memberId))
      .order("desc");
    const result = await (
      isOwner
        ? base
        : base.filter((q) =>
            q.or(
              q.eq(q.field("availability.forTrade"), true),
              q.eq(q.field("availability.forSale"), true),
              q.eq(q.field("availability.forLend"), true),
              q.eq(q.field("heldBy"), viewerId),
            ),
          )
    ).paginate(args.paginationOpts);

    // Sequential: the context's ownerVisibility memo isn't safe to share across a Promise.all.
    let context: CopyViewContext | null = null;
    const visible = [];
    for (const copy of result.page) {
      if (!isOwner) {
        context ??= await buildCopyViewContext(ctx, viewerId);
        if (!(await canViewCopyWithContext(ctx, copy, context))) continue;
      }
      visible.push(copy);
    }

    const page = await Promise.all(
      visible.map(async (copy) => {
        const puzzle = await ctx.db.get(copy.puzzleId);
        return toPublicCopyView(copy, puzzle, {
          coverUrl: await resolveCopyCoverUrl(ctx, copy, puzzle),
        });
      }),
    );
    return { ...result, page };
  },
});
