import { describe, expect, it } from "vitest";
import { CommentText } from "./comment-text";

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

  it("fromState rehydrates without re-validating", () => {
    expect(CommentText.fromState("stored").value).toBe("stored");
  });
});
