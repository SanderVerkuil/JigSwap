import { describe, expect, it } from "vitest";
import { CONDITIONS, Condition, isCondition } from "./condition";

describe("CONDITIONS", () => {
  it("lists every grade best→worst with no gaps", () => {
    expect(CONDITIONS).toEqual([
      "new_sealed",
      "like_new",
      "good",
      "fair",
      "poor",
    ]);
  });
});

describe("isCondition", () => {
  it.each<Condition>(["new_sealed", "like_new", "good", "fair", "poor"])(
    "accepts the known grade %s",
    (value) => {
      expect(isCondition(value)).toBe(true);
    },
  );

  it.each([
    "New_Sealed", // wrong case
    "newsealed", // missing separator
    "excellent", // not in the set
    "", // empty
    " good ", // padded
  ])("rejects the unknown value %j", (value) => {
    expect(isCondition(value)).toBe(false);
  });
});
