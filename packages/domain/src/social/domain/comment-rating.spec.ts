import { describe, expect, it } from "vitest";
import { CommentRating } from "./comment-rating";

describe("CommentRating", () => {
  it.each([1, 2, 3, 4, 5])("accepts the valid rating %i", (value) => {
    const result = CommentRating.create(value);
    expect(result.isOk).toBe(true);
    if (result.isOk) expect(result.value.value).toBe(value);
  });

  it("rejects 0 (below the minimum)", () => {
    const result = CommentRating.create(0);
    expect(result.isErr).toBe(true);
    if (result.isErr) expect(result.error.code).toBe("InvalidCommentRating");
  });

  it("rejects 6 (above the maximum)", () => {
    const result = CommentRating.create(6);
    expect(result.isErr).toBe(true);
    if (result.isErr) expect(result.error.code).toBe("InvalidCommentRating");
  });

  it("rejects a negative rating", () => {
    expect(CommentRating.create(-1).isErr).toBe(true);
  });

  it("rejects a non-integer rating", () => {
    const result = CommentRating.create(2.5);
    expect(result.isErr).toBe(true);
    if (result.isErr) expect(result.error.code).toBe("InvalidCommentRating");
  });

  it("equals compares by value", () => {
    const a = CommentRating.create(3);
    const b = CommentRating.create(3);
    const c = CommentRating.create(4);
    if (!a.isOk || !b.isOk || !c.isOk) throw new Error("setup");
    expect(a.value.equals(b.value)).toBe(true);
    expect(a.value.equals(c.value)).toBe(false);
  });

  it("fromState rehydrates without re-validating", () => {
    expect(CommentRating.fromState(5).value).toBe(5);
  });
});
