import { describe, expect, it } from "vitest";
import { safeReturnTo } from "./return-to";

describe("safeReturnTo", () => {
  it("keeps an in-app path with its search", () => {
    expect(safeReturnTo("/welcome?step=puzzles")).toBe("/welcome?step=puzzles");
    expect(safeReturnTo("/my-puzzles/add/quick")).toBe("/my-puzzles/add/quick");
  });

  it("drops anything that could leave the app", () => {
    for (const value of [
      "https://evil.example",
      "//evil.example",
      "/\\evil.example",
      "javascript:alert(1)",
      "welcome",
      "",
    ]) {
      expect(safeReturnTo(value)).toBeUndefined();
    }
  });

  it("drops non-strings", () => {
    expect(safeReturnTo(undefined)).toBeUndefined();
    expect(safeReturnTo(42)).toBeUndefined();
  });
});
