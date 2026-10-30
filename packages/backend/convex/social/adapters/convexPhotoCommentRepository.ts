import type {
  PhotoComment,
  PhotoCommentId,
  PhotoCommentRepository,
} from "@jigswap/domain";
import type { Doc } from "../../_generated/dataModel";
import type { MutationCtx } from "../../_generated/server";
import { photoCommentToDomain, photoCommentToRow } from "./mappers";

// Driven adapter for the PhotoCommentRepository port over `ctx.db`. The only place the
// `photoComments` table is written for the domain path; the mapper is the ACL. `save` always
// inserts a fresh row (photo comments are never edited); `findById`/`remove` serve the author's
// delete. A photo comment's id is its aggregateId, or the `_id` of a legacy row without one — the
// same id the read side shows.
export const convexPhotoCommentRepository = (
  ctx: MutationCtx,
): PhotoCommentRepository => {
  const rowById = async (
    id: PhotoCommentId,
  ): Promise<Doc<"photoComments"> | null> => {
    const byAggregateId = await ctx.db
      .query("photoComments")
      .withIndex("by_aggregate_id", (q) => q.eq("aggregateId", id))
      .first();
    if (byAggregateId) return byAggregateId;
    const legacyId = ctx.db.normalizeId("photoComments", id);
    return legacyId ? ctx.db.get(legacyId) : null;
  };

  return {
    async save(comment: PhotoComment): Promise<void> {
      await ctx.db.insert("photoComments", photoCommentToRow(comment));
    },

    async findById(id: PhotoCommentId): Promise<PhotoComment | null> {
      const row = await rowById(id);
      return row ? photoCommentToDomain(row) : null;
    },

    async remove(comment: PhotoComment): Promise<void> {
      const row = await rowById(comment.id);
      if (row) await ctx.db.delete(row._id);
    },
  };
};
