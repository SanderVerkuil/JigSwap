import type { PhotoCommentView } from "@jigswap/contracts";
import { v } from "convex/values";
import type { Id } from "../_generated/dataModel";
import { query } from "../_generated/server";
import { requireMember } from "../identity/requireMember";
import { toMemberView } from "../identity/toMemberView";
import { blockedEitherWaySet } from "../social/blocks";
import { canViewCopy } from "./canViewCopy";

// Read side: the discussion comments on a single shared PHOTO, newest first. Keyed by the
// `ownedPuzzleImages` _id the lightbox shows. Each comment joins its REAL author (photo comments are
// voluntary public posts — never anonymised). The author join falls back to a synthetic, nameless
// view (`isActive: false`, the web's "Deleted member") if the user row vanished or is deactivated,
// so an orphaned comment never breaks the list and a tombstone's leftover fields never show.
//
// SECURITY: auth-gated, and the photo's parent copy is run through the SAME reachability gate as
// getCopyInstanceView (canViewCopy) before any comment is returned — a missing photo, missing copy,
// or a private/unreachable copy of another member yields [], so the photo discussion never leaks to
// a viewer who cannot see the copy.
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

    return Promise.all(
      rows
        .filter((row) => !blockedIds.has(row.authorId))
        .map(async (row): Promise<PhotoCommentView> => {
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
