import { beforeEach, describe, expect, it } from "vitest";
import {
  toCommentId,
  toMemberId,
  toPuzzleDefinitionId,
} from "../../../shared-kernel";
import { Comment, CommentId } from "../../domain";
import { InMemoryCommentRepository } from "../testing";
import { makeDeleteComment } from "./delete-comment";

const alice = toMemberId("alice");
const bob = toMemberId("bob");
const puzzleId = toPuzzleDefinitionId("puzzle-1");
const NOW = new Date("2026-10-30T10:00:00Z");

const postAs = (id: CommentId, authorId = alice): Comment => {
  const posted = Comment.post({
    id,
    puzzleId,
    authorId,
    text: "Pristine copy",
    now: NOW,
  });
  if (posted.isErr) throw posted.error;
  return posted.value;
};

describe("makeDeleteComment", () => {
  let comments: InMemoryCommentRepository;
  let deleteComment: ReturnType<typeof makeDeleteComment>;

  beforeEach(async () => {
    comments = new InMemoryCommentRepository();
    await comments.save(postAs(toCommentId("comment-1")));
    await comments.save(postAs(toCommentId("comment-2"), bob));
    deleteComment = makeDeleteComment({ comments });
  });

  it("removes the author's own comment and nothing else", async () => {
    const result = await deleteComment({
      commentId: toCommentId("comment-1"),
      actorId: alice,
    });

    expect(result.isOk).toBe(true);
    expect(comments.all().map((c) => c.id)).toEqual(["comment-2"]);
  });

  it("refuses another member's comment and keeps it", async () => {
    const result = await deleteComment({
      commentId: toCommentId("comment-2"),
      actorId: alice,
    });

    expect(result.isErr).toBe(true);
    if (result.isErr) expect(result.error.code).toBe("NotCommentAuthor");
    expect(comments.size()).toBe(2);
  });

  it("answers CommentNotFound for an unknown comment", async () => {
    const result = await deleteComment({
      commentId: toCommentId("missing"),
      actorId: alice,
    });

    expect(result.isErr).toBe(true);
    if (result.isErr) expect(result.error.code).toBe("CommentNotFound");
    expect(comments.size()).toBe(2);
  });
});
