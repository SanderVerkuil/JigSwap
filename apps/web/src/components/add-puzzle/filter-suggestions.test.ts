import { describe, expect, it } from "vitest";
import { filterSuggestions } from "./filter-suggestions";

const POOL = ["Jumbo", "Ravensburger", "Jan van Haasteren", "Wasgij"];

describe("filterSuggestions", () => {
  it("matches case-insensitive substrings", () => {
    expect(filterSuggestions(POOL, "jum")).toEqual(["Jumbo"]);
    expect(filterSuggestions(POOL, "AAS")).toEqual(["Jan van Haasteren"]);
  });

  it("returns everything (minus exact value) for an empty query", () => {
    expect(filterSuggestions(POOL, "")).toEqual(POOL);
  });

  it("excludes the exact current value, case-insensitively", () => {
    expect(filterSuggestions(POOL, "jumbo")).toEqual([]);
    expect(filterSuggestions(POOL, "Wasgij")).toEqual([]);
  });

  it("trims the query before matching", () => {
    expect(filterSuggestions(POOL, "  jum ")).toEqual(["Jumbo"]);
  });
});
