import { enUS, nl } from "date-fns/locale";
import { describe, expect, it } from "vitest";
import { groupByRecency, type RecencyBucket } from "./notification-groups";

// Local-time dates (month is 0-based), so the day/week/month boundaries are the member's own,
// whatever time zone the test runs in.
const at = (month: number, day: number, hour = 12, minute = 0) =>
  new Date(2026, month, day, hour, minute).getTime();
const OCT = 9;
const SEP = 8;

const row = (id: string, createdAt: number) => ({ id, createdAt });

// bucket -> ids, in the order the page renders them.
const bucketsOf = (
  rows: { id: string; createdAt: number }[],
  now: number,
  weekStartsOn: 0 | 1,
): [RecencyBucket, string[]][] =>
  groupByRecency(rows, now, weekStartsOn).map((group) => [
    group.key,
    group.rows.map((r) => r.id),
  ]);

describe("groupByRecency", () => {
  // Wednesday 28 October 2026, noon.
  const now = at(OCT, 28);
  const rows = [
    row("today", at(OCT, 28, 9)),
    row("yesterday-late", at(OCT, 27, 23, 30)),
    row("monday", at(OCT, 26, 10)),
    row("sunday", at(OCT, 25, 10)),
    row("early-oct", at(OCT, 3)),
    row("sep", at(SEP, 30)),
  ];

  it("splits a week that starts on Sunday (en-US)", () => {
    expect(enUS.options?.weekStartsOn).toBe(0);
    expect(bucketsOf(rows, now, 0)).toEqual([
      ["today", ["today"]],
      ["yesterday", ["yesterday-late"]],
      ["thisWeek", ["monday", "sunday"]],
      ["thisMonth", ["early-oct"]],
      ["earlier", ["sep"]],
    ]);
  });

  it("splits a week that starts on Monday (nl): Sunday is last week", () => {
    expect(nl.options?.weekStartsOn).toBe(1);
    expect(bucketsOf(rows, now, 1)).toEqual([
      ["today", ["today"]],
      ["yesterday", ["yesterday-late"]],
      ["thisWeek", ["monday"]],
      ["thisMonth", ["sunday", "early-oct"]],
      ["earlier", ["sep"]],
    ]);
  });

  it("keeps last month's days of this week in 'this week', and nothing else of last month", () => {
    // Thursday 1 October 2026: the week began in September.
    const first = at(OCT, 1, 10);
    const edge = [
      row("today", at(OCT, 1, 0, 5)),
      row("wed", at(SEP, 30, 18)),
      row("tue", at(SEP, 29, 8)),
      row("sun", at(SEP, 27, 8)),
      row("sat", at(SEP, 26, 8)),
    ];
    expect(bucketsOf(edge, first, 0)).toEqual([
      ["today", ["today"]],
      ["yesterday", ["wed"]],
      ["thisWeek", ["tue", "sun"]],
      ["earlier", ["sat"]],
    ]);
    expect(bucketsOf(edge, first, 1)).toEqual([
      ["today", ["today"]],
      ["yesterday", ["wed"]],
      ["thisWeek", ["tue"]],
      ["earlier", ["sun", "sat"]],
    ]);
  });

  it("puts a row stamped slightly ahead of this device's clock under today", () => {
    expect(bucketsOf([row("skew", now + 5 * 60_000)], now, 1)).toEqual([
      ["today", ["skew"]],
    ]);
  });

  it("returns no groups for no rows", () => {
    expect(groupByRecency([], now, 0)).toEqual([]);
  });
});
