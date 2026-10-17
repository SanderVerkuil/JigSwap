import { describe, expect, it } from "vitest";
import { ratingView } from "./member-stats";

describe("ratingView", () => {
  it("is 'none' when there are no reviews, whatever the average says", () => {
    expect(ratingView({ averageRating: 0, totalReviews: 0 })).toEqual({
      kind: "none",
    });
    expect(ratingView({ averageRating: 4.2, totalReviews: 0 })).toEqual({
      kind: "none",
    });
  });

  it("carries the average and count once reviewed", () => {
    expect(ratingView({ averageRating: 4.8, totalReviews: 3 })).toEqual({
      kind: "rated",
      value: 4.8,
      count: 3,
    });
  });

  it("keeps a whole-number average as-is (formatting is the formatter's job)", () => {
    expect(ratingView({ averageRating: 5, totalReviews: 1 })).toEqual({
      kind: "rated",
      value: 5,
      count: 1,
    });
  });
});
