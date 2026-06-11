import { describe, expect, it } from "vitest";
import { PartnerReviewScores } from "./review-scores";
import { StarRating } from "./star-rating";

describe("StarRating", () => {
  it.each([1, 2, 3, 4, 5])("accepts the in-range integer %s", (value) => {
    const result = StarRating.create(value);
    expect(result.isOk).toBe(true);
    if (result.isOk) expect(result.value.value).toBe(value);
  });

  it.each([0, 6, -1, 100])("rejects the out-of-range value %s", (value) => {
    const result = StarRating.create(value);
    expect(result.isErr).toBe(true);
    if (result.isErr) expect(result.error.code).toBe("InvalidRating");
  });

  it.each([2.5, 3.1, Number.NaN])(
    "rejects the non-integer value %s",
    (value) => {
      const result = StarRating.create(value);
      expect(result.isErr).toBe(true);
      if (result.isErr) expect(result.error.code).toBe("InvalidRating");
    },
  );
});

describe("PartnerReviewScores", () => {
  const valid = { communication: 5, packaging: 4, condition: 3, timeliness: 2 };

  it("constructs from four valid sub-scores and exposes each StarRating", () => {
    const result = PartnerReviewScores.create(valid);
    expect(result.isOk).toBe(true);
    if (result.isOk) {
      expect(result.value.communication.value).toBe(5);
      expect(result.value.packaging.value).toBe(4);
      expect(result.value.condition.value).toBe(3);
      expect(result.value.timeliness.value).toBe(2);
    }
  });

  it.each(["communication", "packaging", "condition", "timeliness"] as const)(
    "rejects when %s is out of range",
    (field) => {
      const result = PartnerReviewScores.create({ ...valid, [field]: 6 });
      expect(result.isErr).toBe(true);
      if (result.isErr) expect(result.error.code).toBe("InvalidRating");
    },
  );
});
