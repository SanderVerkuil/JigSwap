import { describe, expect, it } from "vitest";
import {
  toCommentId,
  toMemberId,
  toPuzzleDefinitionId,
} from "../../shared-kernel";
import { Comment } from "./comment";
import { CommentPosted } from "./events";

const id = toCommentId("comment-1");
const puzzleId = toPuzzleDefinitionId("puzzle-1");
const author = toMemberId("alice");
const NOW = new Date("2026-06-08T10:00:00Z");

const post = (over: Partial<Parameters<typeof Comment.post>[0]> = {}) =>
  Comment.post({
    id,
    puzzleId,
    authorId: author,
    text: "Lovely puzzle",
    now: NOW,
    ...over,
  });

describe("Comment.post", () => {
  it("posts a comment without a rating and records CommentPosted with rating null", () => {
    const result = post();

    expect(result.isOk).toBe(true);
    if (!result.isOk) return;
    const comment = result.value;
    expect(comment.id).toBe(id);
    expect(comment.puzzleId).toBe(puzzleId);
    expect(comment.authorId).toBe(author);
    expect(comment.text.value).toBe("Lovely puzzle");
    expect(comment.rating).toBeUndefined();
    expect(comment.createdAt).toBe(NOW);

    const events = comment.pullEvents();
    expect(events).toHaveLength(1);
    const event = events[0] as CommentPosted;
    expect(event.name).toBe("CommentPosted");
    expect(event.commentId).toBe(id);
    expect(event.puzzleId).toBe(puzzleId);
    expect(event.authorId).toBe(author);
    expect(event.text).toBe("Lovely puzzle");
    expect(event.rating).toBeNull();
    expect(event.occurredAt).toBe(NOW);
  });

  it("posts a comment with a rating and records it in the event payload", () => {
    const result = post({ rating: 4 });

    expect(result.isOk).toBe(true);
    if (!result.isOk) return;
    expect(result.value.rating?.value).toBe(4);

    const event = result.value.pullEvents()[0] as CommentPosted;
    expect(event.rating).toBe(4);
  });

  it("trims surrounding whitespace from the text before storing and emitting", () => {
    const result = post({ text: "  spaced out  " });

    expect(result.isOk).toBe(true);
    if (!result.isOk) return;
    expect(result.value.text.value).toBe("spaced out");
    const event = result.value.pullEvents()[0] as CommentPosted;
    expect(event.text).toBe("spaced out");
  });

  it("accepts the boundary ratings 1 and 5", () => {
    expect(post({ rating: 1 }).isOk).toBe(true);
    expect(post({ rating: 5 }).isOk).toBe(true);
  });

  it("rejects empty text and records no event", () => {
    const result = post({ text: "   " });

    expect(result.isErr).toBe(true);
    if (!result.isErr) return;
    expect(result.error.code).toBe("EmptyCommentText");
  });

  it("rejects a rating below 1", () => {
    const result = post({ rating: 0 });
    expect(result.isErr).toBe(true);
    if (result.isErr) expect(result.error.code).toBe("InvalidCommentRating");
  });

  it("rejects a rating above 5", () => {
    const result = post({ rating: 6 });
    expect(result.isErr).toBe(true);
    if (result.isErr) expect(result.error.code).toBe("InvalidCommentRating");
  });

  it("rejects a non-integer rating", () => {
    const result = post({ rating: 3.5 });
    expect(result.isErr).toBe(true);
    if (result.isErr) expect(result.error.code).toBe("InvalidCommentRating");
  });

  it("validates text before rating: empty text with a bad rating reports EmptyCommentText", () => {
    const result = post({ text: "", rating: 99 });
    expect(result.isErr).toBe(true);
    if (result.isErr) expect(result.error.code).toBe("EmptyCommentText");
  });

  it("pullEvents drains the buffer so a second pull is empty", () => {
    const result = post();
    if (!result.isOk) throw new Error("setup");
    expect(result.value.pullEvents()).toHaveLength(1);
    expect(result.value.pullEvents()).toHaveLength(0);
  });

  it("rehydrate restores state and emits no events", () => {
    const result = post({ rating: 3 });
    if (!result.isOk) throw new Error("setup");
    const state = result.value.toState();

    const rehydrated = Comment.rehydrate(state);
    expect(rehydrated.text.value).toBe("Lovely puzzle");
    expect(rehydrated.rating?.value).toBe(3);
    expect(rehydrated.puzzleId).toBe(puzzleId);
    expect(rehydrated.pullEvents()).toHaveLength(0);
  });
});
