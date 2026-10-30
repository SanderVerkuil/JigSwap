import type { PhotoCommentView, ProjectedMember } from "@jigswap/contracts";
import { v } from "convex/values";
import type { Id } from "../_generated/dataModel";
import { query } from "../_generated/server";
import { requireMember } from "../identity/requireMember";
import { blockedEitherWaySet } from "../social/blocks";
import { projectMemberIdentity } from "../social/privacy";
import { canViewCopy } from "./canViewCopy";

// Read side: the discussion comments on a single shared PHOTO, newest first. Keyed by the
// `ownedPuzzleImages` _id the lightbox shows.
//
// SECURITY: auth-gated, and the photo's parent copy is run through the SAME reachability gate as
// getCopyInstanceView (canViewCopy) before any comment is returned — a missing photo, missing copy,
// or a private/unreachable copy of another member yields [], so the photo discussion never leaks to
// a viewer who cannot see the copy. Each author goes through the privacy chokepoint
// (projectMemberIdentity, salt = the parent copy's _id, so a hidden member reads the same here as
// everywhere else on the copy page) (SEC-11): a private author the viewer is not connected with is
// anonymous, a circle mate sees identity only, and a departed author is anonymous + `departed`.
export const listPhotoComments = query({
  args: { photoId: v.id("ownedPuzzleImages") },
  handler: async (ctx, args): Promise<PhotoCommentView[]> => {
    const viewerId = (await requireMember(ctx)) as unknown as Id<"users">;

    const photo = await ctx.db.get(args.photoId);
    if (!photo) return [];
    const copy = await ctx.db.get(photo.ownedPuzzleId);
    if (!copy || !(await canViewCopy(ctx, viewerId, copy))) return [];

    const rows = await ctx.db
      .query("photoComments")
      .withIndex("by_photo", (q) => q.eq("photoId", args.photoId))
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
          copy._id as string,
        );
        authors.set(authorId, projected);
      }
      return projected;
    };

    return Promise.all(
      rows
        .filter((row) => !blockedIds.has(row.authorId))
        .map(async (row): Promise<PhotoCommentView> => ({
          id: row.aggregateId ?? row._id,
          author: await authorOf(row.authorId),
          text: row.text,
          createdAt: row.createdAt,
        })),
    );
  },
});
