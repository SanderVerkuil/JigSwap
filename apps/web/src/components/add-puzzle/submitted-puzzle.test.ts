import { describe, expect, it } from "vitest";
import { submittedPuzzleId } from "./submitted-puzzle";

describe("submittedPuzzleId", () => {
  const mine = [
    { _id: "p_old", aggregateId: "agg-old" },
    { _id: "p_legacy" },
    { _id: "p_new", aggregateId: "agg-new" },
  ];

  it("finds the just-submitted puzzle's id by its domain id", () => {
    expect(submittedPuzzleId(mine, "agg-new")).toBe("p_new");
  });

  it("is null when the submission is not among the member's pending ones", () => {
    // An admin's submission is approved at once, so it is never in that list.
    expect(submittedPuzzleId(mine, "agg-admin")).toBeNull();
    expect(submittedPuzzleId([], "agg-new")).toBeNull();
  });
});
