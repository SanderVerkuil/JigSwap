import {
  paginationOptsValidator,
  type FilterBuilder,
  type NamedTableInfo,
} from "convex/server";
import { v } from "convex/values";
import type { DataModel, Id } from "../_generated/dataModel";
import { query } from "../_generated/server";
import { requireMember } from "../identity/requireMember";
import {
  buildCopyViewContext,
  canViewCopyWithContext,
  type CopyViewContext,
} from "../library/canViewCopy";
import { seesPrivateCopiesOf } from "../library/copyVisibility";
import { toPublicCopyView } from "../library/mappers";
import { resolveCopyCoverUrl } from "../library/resolveCoverUrl";
import { canSeeProfileContent, seesFullLibrary } from "./privacy";

// Social read: a member's puzzles (owned copies) for their profile page, newest first, paginated.
// Auth-gated. Two gates, in order:
//   1. Profile unlock (canSeeProfileContent): self, public profile, or mutual follower — otherwise
//      an empty, finished page (same shape, nothing leaked).
//   2. Per-copy reachability (canViewCopyWithContext), exactly as Browse / copy detail.
// Rows are the PUBLIC copy projection for every viewer, the owner included: this is the
// visitor-facing profile, so owner-only keys (notes / acquisition provenance) are never present.
//
// Scope (server-computed, never a client flag): a FULL-LIBRARY viewer (self, household mate, mutual
// follower — seesFullLibrary) gets every owned copy for `filter: "all"` (the default) and only the
// open ones (any availability flag) for `filter: "available"`. Everyone else (one-way follower,
// stranger on a public profile) gets today's listings-only view whatever `filter` says.
//
// PRIVATE copies (the owner's per-copy toggle, see library/copyVisibility) are part of "all" only for
// the member themself and their household; a mutual follower's "all" drops them in the index scan
// too (an open copy is never private, so "available" is unaffected).
//
// For a listings-only viewer, the page is pre-filtered in the index scan to the only copies
// canViewCopy can pass for them (open, or currently held by the viewer) so pages stay full; a page
// can still come back short when only circle-shared copies survive the gate.
export const listProfileCopies = query({
  args: {
    memberId: v.id("users"),
    paginationOpts: paginationOptsValidator,
    filter: v.optional(v.union(v.literal("all"), v.literal("available"))),
  },
  handler: async (ctx, args) => {
    const viewerId = (await requireMember(ctx)) as unknown as Id<"users">;
    if (!(await canSeeProfileContent(ctx, viewerId, args.memberId))) {
      return { page: [], isDone: true, continueCursor: "" };
    }
    const isOwner = viewerId === args.memberId;
    const fullLibrary = await seesFullLibrary(ctx, viewerId, args.memberId);
    const seesPrivate =
      fullLibrary && (await seesPrivateCopiesOf(ctx, viewerId, args.memberId));

    const base = ctx.db
      .query("ownedPuzzles")
      .withIndex("by_owner", (q) => q.eq("ownerId", args.memberId))
      .order("desc");
    const open = (
      q: FilterBuilder<NamedTableInfo<DataModel, "ownedPuzzles">>,
    ) =>
      q.or(
        q.eq(q.field("availability.forTrade"), true),
        q.eq(q.field("availability.forSale"), true),
        q.eq(q.field("availability.forLend"), true),
      );
    // Mirrors effectiveCopyVisibility's "private" case (not offered + marker + stored private) as
    // its negation, so a mutual follower's pages stay full. canViewCopy below stays the real gate.
    const notPrivate = (
      q: FilterBuilder<NamedTableInfo<DataModel, "ownedPuzzles">>,
    ) =>
      q.or(
        open(q),
        q.neq(q.field("visibilityAuthoritative"), true),
        q.neq(q.field("visibility"), "private"),
        q.eq(q.field("heldBy"), viewerId),
      );
    const scoped = !fullLibrary
      ? base.filter((q) => q.or(open(q), q.eq(q.field("heldBy"), viewerId)))
      : args.filter === "available"
        ? base.filter(open)
        : seesPrivate
          ? base
          : base.filter(notPrivate);
    const result = await scoped.paginate(args.paginationOpts);

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
