import type { PuzzleCommentView } from "@jigswap/contracts";
import { v } from "convex/values";
import type { Id } from "../_generated/dataModel";
import { query } from "../_generated/server";
import { requireMember } from "../identity/requireMember";
import { toMemberView } from "../identity/toMemberView";
import { canViewCopy } from "../library/canViewCopy";
import { blockedEitherWaySet } from "./blocks";

// Read side: the COPY-scoped comments on the given owned copy (the owner's own plain-text notes),
// newest first — NOT the shared community reviews (those live on the catalog page via
// listPuzzleReviews). Each comment joins its REAL author (comments are voluntary public posts —
// never anonymised). A missing copy returns []. The author join falls back to a synthetic, nameless
// view (`isActive: false`, the web's "Deleted member") if the user row vanished or is deactivated,
// so an orphaned comment never breaks the list and a tombstone's leftover fields never show.
//
// SECURITY: auth-gated, and the copy is run through the SAME reachability gate as getCopyInstanceView
// (canViewCopy) before any comment is returned — a private/unreachable copy of another member yields
// [], so the owner's per-copy notes never leak to a viewer who cannot see the copy.
export const listPuzzleComments = query({
  args: { copyId: v.id("ownedPuzzles") },
  handler: async (ctx, args): Promise<PuzzleCommentView[]> => {
    const viewerId = (await requireMember(ctx)) as unknown as Id<"users">;

    const copy = await ctx.db.get(args.copyId);
    if (!copy) return [];
    if (!(await canViewCopy(ctx, viewerId, copy))) return [];

    const rows = await ctx.db
      .query("puzzleComments")
      .withIndex("by_copy", (q) => q.eq("copyId", args.copyId))
      .order("desc")
      .collect();
    // Authors blocked either way with the viewer drop out (spec 2.6).
    const blockedIds = await blockedEitherWaySet(ctx, viewerId);

    return Promise.all(
      rows
        .filter((row) => !blockedIds.has(row.authorId))
        .map(async (row): Promise<PuzzleCommentView> => {
          const author = await ctx.db.get(row.authorId);
          return {
            id: row.aggregateId ?? row._id,
            author: author?.isActive
              ? toMemberView(author)
              : {
                  _id: row.authorId,
                  _creationTime: 0,
                  isActive: false,
                  createdAt: 0,
                  updatedAt: 0,
                },
            text: row.text,
            createdAt: row.createdAt,
          };
        }),
    );
  },
});
