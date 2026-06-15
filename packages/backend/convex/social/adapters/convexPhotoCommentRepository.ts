import type { PhotoComment, PhotoCommentRepository } from "@jigswap/domain";
import type { MutationCtx } from "../../_generated/server";
import { photoCommentToRow } from "./mappers";

// Driven adapter for the PhotoCommentRepository port over `ctx.db`. The only place the
// `photoComments` table is written for the domain path; the mapper is the ACL. Photo comments are
// append-only, so `save` always inserts a fresh row (the read side projects the table directly into
// view DTOs).
export const convexPhotoCommentRepository = (
  ctx: MutationCtx,
): PhotoCommentRepository => ({
  async save(comment: PhotoComment): Promise<void> {
    await ctx.db.insert("photoComments", photoCommentToRow(comment));
  },
});
