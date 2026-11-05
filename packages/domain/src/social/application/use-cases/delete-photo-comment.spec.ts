import { beforeEach, describe, expect, it } from "vitest";
import {
  toMemberId,
  toPhotoCommentId,
  toPhotoId,
} from "../../../shared-kernel";
import { PhotoComment, PhotoCommentId } from "../../domain";
import { InMemoryPhotoCommentRepository } from "../testing";
import { makeDeletePhotoComment } from "./delete-photo-comment";

const alice = toMemberId("alice");
const bob = toMemberId("bob");
const photoId = toPhotoId("photo-1");
const NOW = new Date("2026-10-30T10:00:00Z");

const postAs = (id: PhotoCommentId, authorId = alice): PhotoComment => {
  const posted = PhotoComment.post({
    id,
    photoId,
    authorId,
    text: "Lovely light",
    now: NOW,
  });
  if (posted.isErr) throw posted.error;
  return posted.value;
};

describe("makeDeletePhotoComment", () => {
  let comments: InMemoryPhotoCommentRepository;
  let deletePhotoComment: ReturnType<typeof makeDeletePhotoComment>;

  beforeEach(async () => {
    comments = new InMemoryPhotoCommentRepository();
    await comments.save(postAs(toPhotoCommentId("photo-comment-1")));
    await comments.save(postAs(toPhotoCommentId("photo-comment-2"), bob));
    deletePhotoComment = makeDeletePhotoComment({ comments });
  });

  it("removes the author's own photo comment and nothing else", async () => {
    const result = await deletePhotoComment({
      commentId: toPhotoCommentId("photo-comment-1"),
      actorId: alice,
    });

    expect(result.isOk).toBe(true);
    expect(comments.all().map((c) => c.id)).toEqual(["photo-comment-2"]);
  });

  it("refuses another member's photo comment and keeps it", async () => {
    const result = await deletePhotoComment({
      commentId: toPhotoCommentId("photo-comment-2"),
      actorId: alice,
    });

    expect(result.isErr).toBe(true);
    if (result.isErr) expect(result.error.code).toBe("NotCommentAuthor");
    expect(comments.size()).toBe(2);
  });

  it("answers CommentNotFound for an unknown photo comment", async () => {
    const result = await deletePhotoComment({
      commentId: toPhotoCommentId("missing"),
      actorId: alice,
    });

    expect(result.isErr).toBe(true);
    if (result.isErr) expect(result.error.code).toBe("CommentNotFound");
    expect(comments.size()).toBe(2);
  });
});
