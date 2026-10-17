import { describe, expect, it } from "vitest";
import {
  pastSolveCandidates,
  toPastCompletionItem,
  yearOptions,
} from "./past-solves";

const copy = (id: string, createdAt: number, aggregateId?: string) => ({
  _id: id,
  aggregateId,
  createdAt,
});

describe("pastSolveCandidates", () => {
  it("lists own copies without any completion, newest first", () => {
    const copies = [
      copy("a", 1, "agg-a"),
      copy("b", 3, "agg-b"),
      copy("c", 2, "agg-c"),
      copy("d", 4, "agg-d"),
    ];
    const completions = [
      { ownedPuzzleId: "a" }, // finished
      { ownedPuzzleId: "d" }, // in progress also counts as "has a completion"
      { ownedPuzzleId: undefined },
    ];
    expect(pastSolveCandidates(copies, completions).map((c) => c._id)).toEqual([
      "b",
      "c",
    ]);
  });

  it("skips legacy copies without an aggregateId (the mutation keys on it)", () => {
    expect(pastSolveCandidates([copy("a", 1)], [])).toEqual([]);
  });
});

describe("toPastCompletionItem", () => {
  it("sends no date for 'I don't remember'", () => {
    expect(
      toPastCompletionItem("agg", {
        when: "unknown",
        year: 2023,
        date: "2024-01-02",
      }),
    ).toEqual({ copyId: "agg", datePrecision: "unknown" });
  });

  it("sends only the year for 'Which year'", () => {
    expect(
      toPastCompletionItem("agg", { when: "year", year: 2023, date: "" }),
    ).toEqual({ copyId: "agg", datePrecision: "year", year: 2023 });
  });

  it("sends the picked day as epoch ms, and nothing when no day is picked", () => {
    expect(
      toPastCompletionItem("agg", {
        when: "day",
        year: 2023,
        date: "2024-03-14",
      }),
    ).toEqual({
      copyId: "agg",
      datePrecision: "day",
      date: new Date("2024-03-14").getTime(),
    });
    expect(
      toPastCompletionItem("agg", { when: "day", year: 2023, date: "" }),
    ).toBeNull();
  });
});

describe("yearOptions", () => {
  it("runs from the current year down to 1950", () => {
    const years = yearOptions(2026);
    expect(years[0]).toBe(2026);
    expect(years.at(-1)).toBe(1950);
    expect(years).toHaveLength(77);
  });
});
