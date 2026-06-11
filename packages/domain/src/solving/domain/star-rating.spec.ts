import { describe, expect, it } from "vitest";
import { StarRating } from "./star-rating";

describe("StarRating", () => {
  it.each([1, 2, 3, 4, 5])("accepts %i stars", (value) => {
    const result = StarRating.create(value);
    expect(result.isOk).toBe(true);
    if (result.isOk) expect(result.value.value).toBe(value);
  });

  it.each([0, 6, -1])("rejects %i stars with InvalidRating", (value) => {
    const result = StarRating.create(value);
    expect(result.isErr).toBe(true);
    if (result.isErr) expect(result.error.code).toBe("InvalidRating");
  });

  it("rejects a fractional rating", () => {
    const result = StarRating.create(3.5);
    expect(result.isErr).toBe(true);
    if (result.isErr) expect(result.error.code).toBe("InvalidRating");
  });

  it("compares by value", () => {
    const three = StarRating.fromState(3);
    expect(three.equals(StarRating.fromState(3))).toBe(true);
    expect(three.equals(StarRating.fromState(4))).toBe(false);
  });
});
