import { describe, expect, it } from "vitest";
import { validateBrowseSearch } from "./browse-search";

describe("validateBrowseSearch", () => {
  it("keeps a puzzle id string", () => {
    expect(validateBrowseSearch({ puzzle: "abc123" })).toEqual({
      puzzle: "abc123",
    });
  });

  it("drops a missing puzzle param", () => {
    expect(validateBrowseSearch({})).toEqual({ puzzle: undefined });
  });

  it("drops an empty or whitespace-only puzzle param", () => {
    expect(validateBrowseSearch({ puzzle: "" })).toEqual({ puzzle: undefined });
    expect(validateBrowseSearch({ puzzle: "  " })).toEqual({
      puzzle: undefined,
    });
  });

  it("drops non-string values (numbers, arrays, objects)", () => {
    expect(validateBrowseSearch({ puzzle: 42 })).toEqual({ puzzle: undefined });
    expect(validateBrowseSearch({ puzzle: ["a"] })).toEqual({
      puzzle: undefined,
    });
    expect(validateBrowseSearch({ puzzle: { id: "a" } })).toEqual({
      puzzle: undefined,
    });
  });

  it("ignores unrelated params", () => {
    expect(validateBrowseSearch({ puzzle: "abc", other: "x" })).toEqual({
      puzzle: "abc",
    });
  });
});
