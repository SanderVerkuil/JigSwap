import { describe, expect, it } from "vitest";
import { toMemberId, toPhotoCommentId, toPhotoId } from "../../shared-kernel";
import { PhotoCommentPosted } from "./events";
import { PhotoComment } from "./photo-comment";

const id = toPhotoCommentId("photo-comment-1");
const photoId = toPhotoId("photo-1");
const author = toMemberId("alice");
const NOW = new Date("2026-06-08T10:00:00Z");

const post = (over: Partial<Parameters<typeof PhotoComment.post>[0]> = {}) =>
  PhotoComment.post({
    id,
    photoId,
    authorId: author,
    text: "Great shot of the corner pieces",
    now: NOW,
    ...over,
  });

describe("PhotoComment.post", () => {
  it("posts a comment and records PhotoCommentPosted with the trimmed text", () => {
    const result = post();

    expect(result.isOk).toBe(true);
    if (!result.isOk) return;
    const comment = result.value;
    expect(comment.id).toBe(id);
    expect(comment.photoId).toBe(photoId);
    expect(comment.authorId).toBe(author);
    expect(comment.text.value).toBe("Great shot of the corner pieces");
    expect(comment.createdAt).toBe(NOW);

    const events = comment.pullEvents();
    expect(events).toHaveLength(1);
    const event = events[0] as PhotoCommentPosted;
    expect(event.name).toBe("PhotoCommentPosted");
    expect(event.commentId).toBe(id);
    expect(event.photoId).toBe(photoId);
    expect(event.authorId).toBe(author);
    expect(event.text).toBe("Great shot of the corner pieces");
    expect(event.occurredAt).toBe(NOW);
  });

  it("trims surrounding whitespace from the text before storing and emitting", () => {
    const result = post({ text: "  spaced out  " });

    expect(result.isOk).toBe(true);
    if (!result.isOk) return;
    expect(result.value.text.value).toBe("spaced out");
    const event = result.value.pullEvents()[0] as PhotoCommentPosted;
    expect(event.text).toBe("spaced out");
  });

  it("rejects empty text and records no event", () => {
    const result = post({ text: "" });

    expect(result.isErr).toBe(true);
    if (!result.isErr) return;
    expect(result.error.code).toBe("EmptyCommentText");
  });

  it("rejects whitespace-only text", () => {
    const result = post({ text: "   \t  " });

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
    const result = post();
    if (!result.isOk) throw new Error("setup");
    const state = result.value.toState();

    const rehydrated = PhotoComment.rehydrate(state);
    expect(rehydrated.text.value).toBe("Great shot of the corner pieces");
    expect(rehydrated.photoId).toBe(photoId);
    expect(rehydrated.authorId).toBe(author);
    expect(rehydrated.createdAt).toBe(NOW);
    expect(rehydrated.pullEvents()).toHaveLength(0);
  });
});
