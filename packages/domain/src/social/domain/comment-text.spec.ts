import { describe, expect, it } from "vitest";
import { COMMENT_TEXT_MAX_LENGTH, CommentText } from "./comment-text";

describe("CommentText", () => {
  it("accepts non-empty text and exposes its value", () => {
    const result = CommentText.create("Great fit");
    expect(result.isOk).toBe(true);
    if (result.isOk) expect(result.value.value).toBe("Great fit");
  });

  it("trims leading/trailing whitespace", () => {
    const result = CommentText.create("  hello  ");
    expect(result.isOk).toBe(true);
    if (result.isOk) expect(result.value.value).toBe("hello");
  });

  it("rejects an empty string", () => {
    const result = CommentText.create("");
    expect(result.isErr).toBe(true);
    if (result.isErr) expect(result.error.code).toBe("EmptyCommentText");
  });

  it("rejects a whitespace-only string", () => {
    const result = CommentText.create("   \t\n");
    expect(result.isErr).toBe(true);
    if (result.isErr) expect(result.error.code).toBe("EmptyCommentText");
  });

  it("accepts text of exactly the maximum length", () => {
    const result = CommentText.create("a".repeat(COMMENT_TEXT_MAX_LENGTH));
    expect(result.isOk).toBe(true);
  });

  it("rejects text longer than the maximum with CommentTextTooLong", () => {
    const result = CommentText.create("a".repeat(COMMENT_TEXT_MAX_LENGTH + 1));
    expect(result.isErr).toBe(true);
    if (result.isErr) expect(result.error.code).toBe("CommentTextTooLong");
  });

  it("measures the cap after trimming", () => {
    const padded = `  ${"a".repeat(COMMENT_TEXT_MAX_LENGTH)}  `;
    const result = CommentText.create(padded);
    expect(result.isOk).toBe(true);
  });

  it("caps comments at 1000 characters", () => {
    expect(COMMENT_TEXT_MAX_LENGTH).toBe(1000);
  });

  it("fromState rehydrates without re-validating", () => {
    expect(CommentText.fromState("stored").value).toBe("stored");
  });

  it("fromState keeps a stored text longer than today's cap", () => {
    const legacy = "a".repeat(COMMENT_TEXT_MAX_LENGTH * 3);
    expect(CommentText.fromState(legacy).value).toBe(legacy);
  });
});
