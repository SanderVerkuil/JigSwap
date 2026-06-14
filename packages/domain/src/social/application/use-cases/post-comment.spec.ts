import { beforeEach, describe, expect, it } from "vitest";
import { toMemberId, toPuzzleDefinitionId } from "../../../shared-kernel";
import { CommentPosted } from "../../domain";
import {
  FixedClock,
  InMemoryCommentRepository,
  RecordingEventPublisher,
  SequentialCommentIdGenerator,
} from "../testing";
import { makePostComment } from "./post-comment";

const alice = toMemberId("alice");
const puzzleId = toPuzzleDefinitionId("puzzle-1");
const NOW = new Date("2026-06-08T10:00:00Z");

describe("makePostComment", () => {
  let comments: InMemoryCommentRepository;
  let events: RecordingEventPublisher;
  let post: ReturnType<typeof makePostComment>;

  beforeEach(() => {
    comments = new InMemoryCommentRepository();
    events = new RecordingEventPublisher();
    post = makePostComment({
      comments,
      commentIds: new SequentialCommentIdGenerator(),
      events,
      clock: new FixedClock(NOW),
    });
  });

  it("posts a comment without a rating: saves it and publishes CommentPosted", async () => {
    const result = await post({ authorId: alice, puzzleId, text: "Nice cut" });

    expect(result.isOk).toBe(true);
    if (result.isOk) expect(result.value).toBe("comment-1");

    expect(comments.size()).toBe(1);
    const stored = comments.all()[0];
    expect(stored.text.value).toBe("Nice cut");
    expect(stored.rating).toBeUndefined();
    expect(stored.puzzleId).toBe(puzzleId);
    expect(stored.authorId).toBe(alice);

    expect(events.names()).toEqual(["CommentPosted"]);
    const event = events.published[0] as CommentPosted;
    expect(event.commentId).toBe("comment-1");
    expect(event.puzzleId).toBe(puzzleId);
    expect(event.authorId).toBe(alice);
    expect(event.text).toBe("Nice cut");
    expect(event.rating).toBeNull();
    expect(event.occurredAt).toBe(NOW);
  });

  it("posts a comment with a rating and carries it on the event", async () => {
    const result = await post({
      authorId: alice,
      puzzleId,
      text: "Loved it",
      rating: 5,
    });

    expect(result.isOk).toBe(true);
    const stored = comments.all()[0];
    expect(stored.rating?.value).toBe(5);
    const event = events.published[0] as CommentPosted;
    expect(event.rating).toBe(5);
  });

  it("mints a fresh id per post so two comments coexist", async () => {
    await post({ authorId: alice, puzzleId, text: "first" });
    await post({ authorId: alice, puzzleId, text: "second" });

    expect(comments.size()).toBe(2);
    expect(events.names()).toEqual(["CommentPosted", "CommentPosted"]);
  });

  it("rejects empty text, persists nothing, and publishes nothing", async () => {
    const result = await post({ authorId: alice, puzzleId, text: "   " });

    expect(result.isErr).toBe(true);
    if (result.isErr) expect(result.error.code).toBe("EmptyCommentText");
    expect(comments.size()).toBe(0);
    expect(events.published).toHaveLength(0);
  });

  it("rejects an out-of-range rating, persists nothing, and publishes nothing", async () => {
    const result = await post({
      authorId: alice,
      puzzleId,
      text: "ok",
      rating: 9,
    });

    expect(result.isErr).toBe(true);
    if (result.isErr) expect(result.error.code).toBe("InvalidCommentRating");
    expect(comments.size()).toBe(0);
    expect(events.published).toHaveLength(0);
  });
});
