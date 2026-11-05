import type { Comment, CommentId, CommentRepository } from "@jigswap/domain";
import type { Doc } from "../../_generated/dataModel";
import type { MutationCtx } from "../../_generated/server";
import { commentToDomain, commentToRow } from "./mappers";

// Driven adapter for the CommentRepository port over `ctx.db`. The only place the `puzzleComments`
// table is written for the domain path; the mapper is the ACL. `save` always inserts a fresh row
// (comments are never edited); `findById`/`remove` serve the author's delete. A comment's id is its
// aggregateId, or the `_id` of a legacy row without one — the same id the read side shows.
export const convexCommentRepository = (
  ctx: MutationCtx,
): CommentRepository => {
  const rowById = async (
    id: CommentId,
  ): Promise<Doc<"puzzleComments"> | null> => {
    const byAggregateId = await ctx.db
      .query("puzzleComments")
      .withIndex("by_aggregate_id", (q) => q.eq("aggregateId", id))
      .first();
    if (byAggregateId) return byAggregateId;
    const legacyId = ctx.db.normalizeId("puzzleComments", id);
    return legacyId ? ctx.db.get(legacyId) : null;
  };

  return {
    async save(comment: Comment): Promise<void> {
      await ctx.db.insert("puzzleComments", commentToRow(comment));
    },

    async findById(id: CommentId): Promise<Comment | null> {
      const row = await rowById(id);
      return row ? commentToDomain(row) : null;
    },

    async remove(comment: Comment): Promise<void> {
      const row = await rowById(comment.id);
      if (row) await ctx.db.delete(row._id);
    },
  };
};
