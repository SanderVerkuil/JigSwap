import { describe, expect, it } from "vitest";
import {
  groupSolveHistory,
  HISTORY_PAGE_SIZE,
  withJoinPages,
  type HistoryRow,
} from "./completion-history";

// The completion log's finished solves: one group per year (newest first), solves known only by
// their year after that year's dated ones, undated solves last, and only the first page shown.

type Row = HistoryRow & { id: string };

// Dated solves are calendar dates stored at UTC midnight (lib/date-input).
const day = (id: string, y: number, m: number, d: number): Row => ({
  id,
  startDate: Date.UTC(y, m, d),
  endDate: Date.UTC(y, m, d),
});
// The domain's year sentinel: 1 July at UTC noon.
const yearOnly = (id: string, y: number): Row => ({
  id,
  startDate: Date.UTC(y, 6, 1, 12),
  endDate: Date.UTC(y, 6, 1, 12),
  datePrecision: "year",
});
// An undated solve holds the day it was logged as its sentinel.
const undated = (id: string, loggedAt: number): Row => ({
  id,
  startDate: loggedAt,
  endDate: loggedAt,
  datePrecision: "unknown",
});

const ids = (rows: readonly Row[]) => rows.map((row) => row.id);

describe("groupSolveHistory", () => {
  it("groups solves by year, newest year and newest solve first", () => {
    const { groups } = groupSolveHistory(
      [
        day("a", 2025, 2, 4),
        day("b", 2026, 9, 1),
        day("c", 2026, 0, 1),
        day("d", 2025, 11, 31),
        day("e", 2026, 4, 20),
      ],
      HISTORY_PAGE_SIZE,
    );
    expect(groups.map((g) => g.key)).toEqual([2026, 2025]);
    expect(ids(groups[0].rows)).toEqual(["b", "e", "c"]);
    expect(ids(groups[1].rows)).toEqual(["d", "a"]);
  });

  it("files a solve by its calendar date, so 1 January is in its own year in every time zone", () => {
    const { groups } = groupSolveHistory(
      [day("new-year", 2026, 0, 1), day("eve", 2025, 11, 31)],
      HISTORY_PAGE_SIZE,
    );
    expect(groups.map((g) => [g.key, ids(g.rows)])).toEqual([
      [2026, ["new-year"]],
      [2025, ["eve"]],
    ]);
  });

  it("files a legacy finished row without an end date by its start date", () => {
    const { groups } = groupSolveHistory(
      [{ id: "legacy", startDate: Date.UTC(2024, 3, 2) }],
      HISTORY_PAGE_SIZE,
    );
    expect(groups.map((g) => g.key)).toEqual([2024]);
  });

  it("puts a solve known only by its year under that year, after the dated ones", () => {
    const { groups } = groupSolveHistory(
      [
        day("march", 2023, 2, 1),
        yearOnly("y2023", 2023),
        day("dec", 2023, 11, 1),
        yearOnly("y2021", 2021),
      ],
      HISTORY_PAGE_SIZE,
    );
    expect(groups.map((g) => [g.key, ids(g.rows)])).toEqual([
      [2023, ["dec", "march", "y2023"]],
      [2021, ["y2021"]],
    ]);
  });

  it("collects undated solves in a last group, although their sentinel is recent", () => {
    const { groups } = groupSolveHistory(
      [
        undated("u-old", Date.UTC(2026, 1, 1)),
        day("dated", 2019, 4, 4),
        undated("u-new", Date.UTC(2026, 9, 30)),
      ],
      HISTORY_PAGE_SIZE,
    );
    expect(groups.map((g) => [g.key, ids(g.rows)])).toEqual([
      [2019, ["dated"]],
      ["unknown", ["u-new", "u-old"]],
    ]);
  });

  it("shows only the first page, in display order, and counts every solve per group", () => {
    const rows = [
      ...Array.from({ length: 4 }, (_, i) => day(`n${i}`, 2026, 5, i + 1)),
      ...Array.from({ length: 3 }, (_, i) => day(`o${i}`, 2025, 5, i + 1)),
      undated("u", Date.UTC(2026, 9, 30)),
    ];
    const page = groupSolveHistory(rows, 5);
    expect(page.shown).toBe(5);
    expect(page.total).toBe(8);
    // 2025 is cut by the page: its heading still says how many solves it holds.
    expect(page.groups.map((g) => [g.key, g.rows.length, g.total])).toEqual([
      [2026, 4, 4],
      [2025, 1, 3],
    ]);
    expect(ids(page.groups[1].rows)).toEqual(["o2"]);
  });

  it("shows everything once the page covers every solve", () => {
    const rows = [day("a", 2026, 0, 2), undated("u", Date.UTC(2026, 9, 30))];
    const page = groupSolveHistory(rows, 30);
    expect(page.shown).toBe(2);
    expect(page.total).toBe(2);
    expect(page.groups.map((g) => g.key)).toEqual([2026, "unknown"]);
  });

  it("has no groups without solves", () => {
    expect(groupSolveHistory([], HISTORY_PAGE_SIZE)).toEqual({
      groups: [],
      shown: 0,
      total: 0,
    });
  });

  it("pages 30 solves at a time", () => {
    expect(HISTORY_PAGE_SIZE).toBe(30);
  });
});

describe("withJoinPages", () => {
  const ids = (from: number, to: number) =>
    Array.from({ length: to - from }, (_, i) => `s${from + i}`);

  it("splits what it hasn't asked for into pages", () => {
    expect(withJoinPages([], ids(0, 65)).map((page) => page.length)).toEqual([
      30, 30, 5,
    ]);
  });

  it("hands back the same pages when nothing is new, so a render can tell", () => {
    const pages = withJoinPages([], ids(0, 40));
    expect(withJoinPages(pages, ids(0, 40))).toBe(pages);
    expect(withJoinPages(pages, ids(5, 10))).toBe(pages);
  });

  it("never changes a page it has asked for, wherever a solve moved to", () => {
    const pages = withJoinPages([], ids(0, 40));
    const next = withJoinPages(pages, ["new", ...ids(0, 40)]);
    expect(next.slice(0, pages.length)).toEqual(pages);
    expect(next.at(-1)).toEqual(["new"]);
  });
});
