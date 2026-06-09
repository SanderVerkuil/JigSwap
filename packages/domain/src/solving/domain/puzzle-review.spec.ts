import { describe, expect, it } from "vitest";
import { PuzzleReview } from "./puzzle-review";
import { StarRating } from "./star-rating";

describe("PuzzleReview", () => {
  const four = StarRating.fromState(4);

  it("carries the rating and trimmed text", () => {
    const review = PuzzleReview.create(four, "  loved it  ");
    expect(review.rating.value).toBe(4);
    expect(review.text).toBe("loved it");
  });

  it("normalises empty/whitespace text to undefined", () => {
    expect(PuzzleReview.create(four, "   ").text).toBeUndefined();
    expect(PuzzleReview.create(four, "").text).toBeUndefined();
    expect(PuzzleReview.create(four).text).toBeUndefined();
  });

  it("round-trips through state", () => {
    const review = PuzzleReview.create(four, "nice");
    const state = review.toState();
    expect(state).toEqual({ rating: 4, text: "nice" });
    const rehydrated = PuzzleReview.fromState(state);
    expect(rehydrated.rating.value).toBe(4);
    expect(rehydrated.text).toBe("nice");
  });
});
