import {
  makePostPhotoComment,
  type MemberId,
  type PhotoId,
  toMemberId,
  toPhotoId,
} from "@jigswap/domain";
import { ConvexError, v } from "convex/values";
import { mutation } from "../_generated/server";
import { requireMember } from "../identity/requireMember";
import { convexPhotoCommentRepository } from "../social/adapters/convexPhotoCommentRepository";
import { photoCommentIdGenerator } from "../social/adapters/idGenerators";
import { inProcessEventPublisher } from "../social/adapters/inProcessEventPublisher";
import { systemClock } from "../social/adapters/systemClock";
import { toConvexError } from "../social/errors";

// Composition root for posting a discussion comment on a single shared PHOTO. The comment is keyed
// to the `ownedPuzzleImages` _id (the lightbox the UI shows). Anyone authenticated may comment —
// these are public discussion on a shared photo — so the author is derived from auth and we only
// require that the photo exists. The PhotoComment aggregate validates the text.
export const postPhotoComment = mutation({
  args: {
    photoId: v.id("ownedPuzzleImages"),
    text: v.string(),
  },
  handler: async (ctx, args) => {
    const authorId = (await requireMember(ctx)) as unknown as MemberId;

    const photo = await ctx.db.get(args.photoId);
    if (!photo) throw new ConvexError("Photo not found");

    const post = makePostPhotoComment({
      comments: convexPhotoCommentRepository(ctx),
      commentIds: photoCommentIdGenerator,
      events: inProcessEventPublisher(ctx),
      clock: systemClock,
    });

    const result = await post({
      authorId: toMemberId(authorId as unknown as string),
      // Carry the Convex `ownedPuzzleImages` id as the domain PhotoId (the mapper re-brands it to the
      // `photoId` FK column on save).
      photoId: toPhotoId(args.photoId as unknown as string) as PhotoId,
      text: args.text,
    });
    if (result.isErr) throw toConvexError(result.error);
  },
});
