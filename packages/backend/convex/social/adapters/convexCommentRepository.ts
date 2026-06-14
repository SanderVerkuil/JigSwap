import type { Comment, CommentRepository } from "@jigswap/domain";
import type { MutationCtx } from "../../_generated/server";
import { commentToRow } from "./mappers";

// Driven adapter for the CommentRepository port over `ctx.db`. The only place the `puzzleComments`
// table is written for the domain path; the mapper is the ACL. Comments are append-only, so `save`
// always inserts a fresh row (the read side projects the table directly into view DTOs).
export const convexCommentRepository = (
  ctx: MutationCtx,
): CommentRepository => ({
  async save(comment: Comment): Promise<void> {
    await ctx.db.insert("puzzleComments", commentToRow(comment));
  },
});
