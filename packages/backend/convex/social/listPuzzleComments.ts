import type { ProjectedMember, PuzzleCommentView } from "@jigswap/contracts";
import { v } from "convex/values";
import type { Id } from "../_generated/dataModel";
import { query } from "../_generated/server";
import { requireMember } from "../identity/requireMember";
import { canViewCopy } from "../library/canViewCopy";
import { blockedEitherWaySet } from "./blocks";
import { projectMemberIdentity } from "./privacy";

// Read side: the COPY-scoped comments on the given owned copy (the owner's own plain-text notes),
// newest first — NOT the shared community reviews (those live on the catalog page via
// listPuzzleReviews). A missing copy returns [].
//
// SECURITY: auth-gated, and the copy is run through the SAME reachability gate as getCopyInstanceView
// (canViewCopy) before any comment is returned — a private/unreachable copy of another member yields
// [], so the owner's per-copy notes never leak to a viewer who cannot see the copy. Each author goes
// through the privacy chokepoint (projectMemberIdentity, salt = the copy's _id, as on the copy page)
// (SEC-11): a private author the viewer is not connected with is anonymous, a circle mate sees
// identity only, and a departed author is anonymous + `departed` (the web's "Deleted member").
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

    // One projection per author: a member who commented twice reads as one person.
    const authors = new Map<Id<"users">, Promise<ProjectedMember>>();
    const authorOf = (authorId: Id<"users">) => {
      let projected = authors.get(authorId);
      if (!projected) {
        projected = projectMemberIdentity(
          ctx,
          viewerId,
          authorId,
          args.copyId as string,
        );
        authors.set(authorId, projected);
      }
      return projected;
    };

    return Promise.all(
      rows
        .filter((row) => !blockedIds.has(row.authorId))
        .map(async (row): Promise<PuzzleCommentView> => ({
          id: row.aggregateId ?? row._id,
          author: await authorOf(row.authorId),
          text: row.text,
          createdAt: row.createdAt,
        })),
    );
  },
});
