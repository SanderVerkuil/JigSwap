import type { PhotoCommentView } from "@jigswap/contracts";
import { v } from "convex/values";
import { query } from "../_generated/server";
import { toMemberView } from "../identity/toMemberView";

// Read side: the discussion comments on a single shared PHOTO, newest first. Keyed by the
// `ownedPuzzleImages` _id the lightbox shows. Each comment joins its REAL author (photo comments are
// voluntary public posts — never anonymised). The author join falls back to a synthetic "Member"
// view if the user row vanished, so an orphaned comment never breaks the list.
export const listPhotoComments = query({
  args: { photoId: v.id("ownedPuzzleImages") },
  handler: async (ctx, args): Promise<PhotoCommentView[]> => {
    const rows = await ctx.db
      .query("photoComments")
      .withIndex("by_photo", (q) => q.eq("photoId", args.photoId))
      .order("desc")
      .collect();

    return Promise.all(
      rows.map(async (row): Promise<PhotoCommentView> => {
        const author = await ctx.db.get(row.authorId);
        return {
          id: row.aggregateId ?? row._id,
          author: author
            ? toMemberView(author)
            : {
                _id: row.authorId,
                _creationTime: 0,
                clerkId: "",
                email: "",
                name: "Member",
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
