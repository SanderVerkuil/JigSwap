import { describe, expect, it } from "vitest";
import {
  pastSolveCandidates,
  pastSolveRows,
  toPastCompletionItem,
  yearOptions,
} from "./past-solves";

const TODAY = "2026-11-02";

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
    // "a" is finished; "d" is in progress, which also counts as "has a completion".
    const solved = new Set(["a", "d"]);
    expect(pastSolveCandidates(copies, solved).map((c) => c._id)).toEqual([
      "b",
      "c",
    ]);
  });

  it("skips legacy copies without an aggregateId (the mutation keys on it)", () => {
    expect(pastSolveCandidates([copy("a", 1)], new Set())).toEqual([]);
  });
});

describe("toPastCompletionItem", () => {
  it("sends no date for 'I don't remember'", () => {
    expect(
      toPastCompletionItem(
        "agg",
        {
          when: "unknown",
          year: 2023,
          date: "2024-01-02",
        },
        TODAY,
      ),
    ).toEqual({ copyId: "agg", datePrecision: "unknown" });
  });

  it("sends only the year for 'Which year'", () => {
    expect(
      toPastCompletionItem(
        "agg",
        { when: "year", year: 2023, date: "" },
        TODAY,
      ),
    ).toEqual({ copyId: "agg", datePrecision: "year", year: 2023 });
  });

  it("sends the picked day as UTC midnight, and nothing when no day is picked", () => {
    expect(
      toPastCompletionItem(
        "agg",
        {
          when: "day",
          year: 2023,
          date: "2024-03-14",
        },
        TODAY,
      ),
    ).toEqual({
      copyId: "agg",
      datePrecision: "day",
      date: Date.UTC(2024, 2, 14),
    });
    expect(
      toPastCompletionItem("agg", { when: "day", year: 2023, date: "" }, TODAY),
    ).toBeNull();
  });

  it("sends today, and nothing for a day after it, which the server would refuse", () => {
    expect(
      toPastCompletionItem(
        "agg",
        { when: "day", year: 2026, date: TODAY },
        TODAY,
      ),
    ).not.toBeNull();
    expect(
      toPastCompletionItem(
        "agg",
        { when: "day", year: 2026, date: "2026-11-03" },
        TODAY,
      ),
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

describe("pastSolveRows", () => {
  const CANDIDATES = [
    {
      copyId: "a",
      title: "Mountain Lake",
      brand: "Ravensburger",
      pieceCount: 1000,
    },
    { copyId: "b", title: "Café de Paris", brand: "Goliath", pieceCount: 500 },
    { copyId: "c", title: "Harbour", pieceCount: 1000 },
    { copyId: "d", title: "Cats" },
  ];
  const NONE = new Set<string>();
  const rows = (
    term: string,
    {
      shown = 25,
      ticked = NONE,
      waiting = NONE,
    }: {
      shown?: number;
      ticked?: ReadonlySet<string>;
      waiting?: ReadonlySet<string>;
    } = {},
  ) => {
    const result = pastSolveRows(CANDIDATES, { term, shown, ticked, waiting });
    return { ...result, ids: result.rows.map((row) => row.copyId) };
  };

  it("pages the whole list without a search", () => {
    expect(rows("").ids).toEqual(["a", "b", "c", "d"]);
    expect(rows("").more).toBe(false);
    expect(rows("   ", { shown: 2 }).ids).toEqual(["a", "b"]);
    expect(rows("", { shown: 2 }).more).toBe(true);
  });

  it("finds a title, a brand or a piece count, ignoring case and accents", () => {
    expect(rows("MOUNTAIN").ids).toEqual(["a"]);
    expect(rows("goliath").ids).toEqual(["b"]);
    expect(rows("cafe").ids).toEqual(["b"]);
    expect(rows("1000").ids).toEqual(["a", "c"]);
  });

  it("needs every word, in any order", () => {
    expect(rows("1000 ravens").ids).toEqual(["a"]);
    expect(rows("ravens harbour").ids).toEqual([]);
  });

  it("says when nothing matches", () => {
    expect(rows("zzz").noMatch).toBe(true);
    expect(rows("cats").noMatch).toBe(false);
    expect(rows("").noMatch).toBe(false);
  });

  it("keeps a ticked row out of a search that doesn't match it", () => {
    expect(rows("cats", { ticked: new Set(["a"]) }).ids).toEqual(["d"]);
  });

  it("keeps a row that holds the submit back in view through any search, and still says no match", () => {
    const held = rows("zzz", {
      ticked: new Set(["a"]),
      waiting: new Set(["a"]),
    });
    expect(held.ids).toEqual(["a"]);
    expect(held.noMatch).toBe(true);
    expect(
      rows("cats", { ticked: new Set(["a"]), waiting: new Set(["a"]) }).ids,
    ).toEqual(["a", "d"]);
  });

  it("keeps a row ticked through a search on the list past the page, in its place", () => {
    const paged = rows("", { shown: 1, ticked: new Set(["c"]) });
    expect(paged.ids).toEqual(["a", "c"]);
    expect(paged.more).toBe(true);
    expect(rows("", { shown: 3, ticked: new Set(["d"]) }).more).toBe(false);
  });
});
