import { beforeEach, describe, expect, it } from "vitest";
import { toMemberId, toPhotoId } from "../../../shared-kernel";
import { PhotoCommentPosted } from "../../domain";
import {
  FixedClock,
  InMemoryPhotoCommentRepository,
  RecordingEventPublisher,
  SequentialPhotoCommentIdGenerator,
} from "../testing";
import { makePostPhotoComment } from "./post-photo-comment";

const alice = toMemberId("alice");
const photoId = toPhotoId("photo-1");
const NOW = new Date("2026-06-08T10:00:00Z");

describe("makePostPhotoComment", () => {
  let comments: InMemoryPhotoCommentRepository;
  let events: RecordingEventPublisher;
  let post: ReturnType<typeof makePostPhotoComment>;

  beforeEach(() => {
    comments = new InMemoryPhotoCommentRepository();
    events = new RecordingEventPublisher();
    post = makePostPhotoComment({
      comments,
      commentIds: new SequentialPhotoCommentIdGenerator(),
      events,
      clock: new FixedClock(NOW),
    });
  });

  it("posts a comment: saves it and publishes PhotoCommentPosted", async () => {
    const result = await post({ authorId: alice, photoId, text: "Nice angle" });

    expect(result.isOk).toBe(true);
    if (result.isOk) expect(result.value).toBe("photo-comment-1");

    expect(comments.size()).toBe(1);
    const stored = comments.all()[0];
    expect(stored.text.value).toBe("Nice angle");
    expect(stored.photoId).toBe(photoId);
    expect(stored.authorId).toBe(alice);
    expect(stored.createdAt).toBe(NOW);

    expect(events.names()).toEqual(["PhotoCommentPosted"]);
    const event = events.published[0] as PhotoCommentPosted;
    expect(event.commentId).toBe("photo-comment-1");
    expect(event.photoId).toBe(photoId);
    expect(event.authorId).toBe(alice);
    expect(event.text).toBe("Nice angle");
    expect(event.occurredAt).toBe(NOW);
  });

  it("mints a fresh id per post so two comments coexist", async () => {
    await post({ authorId: alice, photoId, text: "first" });
    await post({ authorId: alice, photoId, text: "second" });

    expect(comments.size()).toBe(2);
    expect(events.names()).toEqual([
      "PhotoCommentPosted",
      "PhotoCommentPosted",
    ]);
  });

  it("rejects empty text, persists nothing, and publishes nothing", async () => {
    const result = await post({ authorId: alice, photoId, text: "   " });

    expect(result.isErr).toBe(true);
    if (result.isErr) expect(result.error.code).toBe("EmptyCommentText");
    expect(comments.size()).toBe(0);
    expect(events.published).toHaveLength(0);
  });
});
