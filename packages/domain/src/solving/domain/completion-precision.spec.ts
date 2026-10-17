import { describe, expect, it } from "vitest";
import { toCompletionId, toMemberId } from "../../shared-kernel";
import { Completion } from "./completion";
import { CompletionRecorded } from "./events";

// Completion date precision (spec 2026-10-17 §3.2): "year" and "unknown" solves are stored as
// FINISHED completions with sentinel dates and no duration, so the in-progress invariant holds.

const ID = toCompletionId("completion-1");
const ALICE = toMemberId("alice");
const NOW = new Date("2026-10-17T08:00:00Z");
const DAY_START = new Date("2026-10-10T10:00:00Z");
const DAY_END = new Date("2026-10-10T11:00:00Z");

type RecordProps = Parameters<typeof Completion.record>[0];

const record = (overrides: Partial<RecordProps>) =>
  Completion.record({
    id: ID,
    userId: ALICE,
    datePrecision: "day",
    now: NOW,
    ...overrides,
  });

const recordedEvent = (c: Completion): CompletionRecorded => {
  const [event] = c.pullEvents();
  if (!(event instanceof CompletionRecorded)) throw new Error("no event");
  return event;
};

const okValue = (result: ReturnType<typeof record>): Completion => {
  if (!result.isOk) throw new Error(`expected ok, got ${result.error.code}`);
  return result.value;
};

const errCode = (result: { isErr: boolean; error?: { code: string } }) =>
  result.isErr ? result.error?.code : "ok";

describe("Completion.record with datePrecision 'day'", () => {
  it("keeps today's behaviour and records the precision", () => {
    const c = okValue(record({ startDate: DAY_START, endDate: DAY_END }));
    expect(c.toState().datePrecision).toBe("day");
    expect(c.toState().completionTimeMinutes).toBe(60);
    const event = recordedEvent(c);
    // The payload carries the precision only when it isn't "day".
    expect(event.datePrecision).toBeUndefined();
    expect(event.bulk).toBeUndefined();
  });

  it("requires both dates", () => {
    expect(errCode(record({ startDate: DAY_START }))).toBe(
      "InvalidDatePrecision",
    );
    expect(errCode(record({ endDate: DAY_END }))).toBe("InvalidDatePrecision");
  });

  it("rejects a year alongside a full date", () => {
    expect(
      errCode(record({ startDate: DAY_START, endDate: DAY_END, year: 2023 })),
    ).toBe("InvalidDatePrecision");
  });

  it("still rejects an end before its start", () => {
    expect(errCode(record({ startDate: DAY_END, endDate: DAY_START }))).toBe(
      "InvalidTimeRange",
    );
  });

  it("marks a batch-recorded solve as bulk on the event", () => {
    const c = okValue(
      record({ startDate: DAY_START, endDate: DAY_END, bulk: true }),
    );
    expect(recordedEvent(c).bulk).toBe(true);
  });

  it("leaves bulk off when explicitly false", () => {
    const c = okValue(
      record({ startDate: DAY_START, endDate: DAY_END, bulk: false }),
    );
    expect(recordedEvent(c).bulk).toBeUndefined();
  });
});

describe("Completion.record with datePrecision 'year'", () => {
  it("stores a finished completion at the mid-year sentinel with no duration", () => {
    const c = okValue(record({ datePrecision: "year", year: 2023 }));
    const state = c.toState();
    expect(state.datePrecision).toBe("year");
    expect(state.isCompleted).toBe(true);
    expect(state.startDate.toISOString()).toBe("2023-07-01T12:00:00.000Z");
    expect(state.endDate?.toISOString()).toBe("2023-07-01T12:00:00.000Z");
    expect(state.completionTimeMinutes).toBeUndefined();
    expect(state.createdAt).toBe(NOW);

    const event = recordedEvent(c);
    expect(event.datePrecision).toBe("year");
    expect(event.completionTimeMinutes).toBeUndefined();
    expect(event.startDate.toISOString()).toBe("2023-07-01T12:00:00.000Z");
    expect(event.endDate.toISOString()).toBe("2023-07-01T12:00:00.000Z");
  });

  it("keeps a current-year solve out of the future", () => {
    const january = new Date("2026-01-05T09:00:00Z");
    const c = okValue(
      record({ datePrecision: "year", year: 2026, now: january }),
    );
    expect(c.toState().endDate?.getTime()).toBe(january.getTime());
  });

  it("accepts the year bounds 1900 and the current UTC year", () => {
    expect(errCode(record({ datePrecision: "year", year: 1900 }))).toBe("ok");
    expect(errCode(record({ datePrecision: "year", year: 2026 }))).toBe("ok");
  });

  it("rejects years outside 1900..current and non-integers", () => {
    expect(errCode(record({ datePrecision: "year", year: 1899 }))).toBe(
      "InvalidYear",
    );
    expect(errCode(record({ datePrecision: "year", year: 2027 }))).toBe(
      "InvalidYear",
    );
    expect(errCode(record({ datePrecision: "year", year: 2023.5 }))).toBe(
      "InvalidYear",
    );
  });

  it("requires a year and refuses full dates", () => {
    expect(errCode(record({ datePrecision: "year" }))).toBe(
      "InvalidDatePrecision",
    );
    expect(
      errCode(record({ datePrecision: "year", year: 2023, startDate: NOW })),
    ).toBe("InvalidDatePrecision");
    expect(
      errCode(record({ datePrecision: "year", year: 2023, endDate: NOW })),
    ).toBe("InvalidDatePrecision");
  });

  it("refuses a duration", () => {
    expect(
      errCode(
        record({
          datePrecision: "year",
          year: 2023,
          completionTimeMinutes: 90,
        }),
      ),
    ).toBe("DurationNotAllowed");
  });
});

describe("Completion.record with datePrecision 'unknown'", () => {
  it("stores a finished completion dated at its creation with no duration", () => {
    const c = okValue(record({ datePrecision: "unknown" }));
    const state = c.toState();
    expect(state.datePrecision).toBe("unknown");
    expect(state.isCompleted).toBe(true);
    expect(state.startDate.getTime()).toBe(NOW.getTime());
    expect(state.endDate?.getTime()).toBe(NOW.getTime());
    expect(state.completionTimeMinutes).toBeUndefined();
    expect(recordedEvent(c).datePrecision).toBe("unknown");
  });

  it("refuses dates, a year and a duration", () => {
    expect(errCode(record({ datePrecision: "unknown", startDate: NOW }))).toBe(
      "InvalidDatePrecision",
    );
    expect(errCode(record({ datePrecision: "unknown", endDate: NOW }))).toBe(
      "InvalidDatePrecision",
    );
    expect(errCode(record({ datePrecision: "unknown", year: 2023 }))).toBe(
      "InvalidDatePrecision",
    );
    expect(
      errCode(record({ datePrecision: "unknown", completionTimeMinutes: 30 })),
    ).toBe("DurationNotAllowed");
  });
});

describe("start and finish always produce 'day'", () => {
  it("starts and finishes at day precision", () => {
    const started = Completion.start({
      id: ID,
      userId: ALICE,
      startDate: DAY_START,
      now: NOW,
    });
    if (!started.isOk) throw new Error("start failed");
    expect(started.value.toState().datePrecision).toBe("day");
    started.value.pullEvents();
    expect(started.value.finish(DAY_END, NOW).isOk).toBe(true);
    expect(started.value.toState().datePrecision).toBe("day");
    expect(recordedEvent(started.value).datePrecision).toBeUndefined();
  });
});

describe("Completion.edit on an undated or year-only solve", () => {
  // Undated rows are anchored on their creation instant, so the 24h window is open right after.
  const unknown = () => okValue(record({ datePrecision: "unknown" }));
  const SOON = new Date(NOW.getTime() + 60 * 60 * 1000);
  const PICKED = new Date("2026-10-01T00:00:00Z");

  it("keeps the precision and the sentinel when only notes change", () => {
    const c = unknown();
    expect(c.edit(ALICE, { notes: "lovely" }, SOON).isOk).toBe(true);
    const state = c.toState();
    expect(state.datePrecision).toBe("unknown");
    expect(state.completionTimeMinutes).toBeUndefined();
    expect(state.notes).toBe("lovely");
  });

  it("refuses a duration without a date", () => {
    const outcome = unknown().edit(ALICE, { completionTimeMinutes: 45 }, SOON);
    expect(errCode(outcome)).toBe("DurationNotAllowed");
  });

  it("upgrades to 'day' when a start date is set, using it for both ends", () => {
    const c = unknown();
    expect(c.edit(ALICE, { startDate: PICKED }, SOON).isOk).toBe(true);
    const state = c.toState();
    expect(state.datePrecision).toBe("day");
    expect(state.startDate).toBe(PICKED);
    expect(state.endDate).toBe(PICKED);
    expect(state.completionTimeMinutes).toBe(1440);
  });

  it("upgrades to 'day' when an end date is set, using it for both ends", () => {
    const c = unknown();
    expect(c.edit(ALICE, { endDate: PICKED }, SOON).isOk).toBe(true);
    const state = c.toState();
    expect(state.datePrecision).toBe("day");
    expect(state.startDate).toBe(PICKED);
    expect(state.endDate).toBe(PICKED);
  });

  it("upgrades with both dates and an explicit duration", () => {
    const c = unknown();
    const end = new Date(PICKED.getTime() + 3 * 60 * 60 * 1000);
    expect(
      c.edit(
        ALICE,
        { startDate: PICKED, endDate: end, completionTimeMinutes: 100 },
        SOON,
      ).isOk,
    ).toBe(true);
    const state = c.toState();
    expect(state.datePrecision).toBe("day");
    expect(state.startDate).toBe(PICKED);
    expect(state.endDate).toBe(end);
    expect(state.completionTimeMinutes).toBe(100);
  });

  it("still applies the 24h window, anchored on the sentinel", () => {
    const year = okValue(record({ datePrecision: "year", year: 2023 }));
    expect(errCode(year.edit(ALICE, { startDate: PICKED }, NOW))).toBe(
      "EditWindowClosed",
    );
  });

  it("does not cross-fill a single date on a dated row", () => {
    const c = okValue(record({ startDate: DAY_START, endDate: DAY_END }));
    const later = new Date(DAY_END.getTime() + 60 * 60 * 1000);
    expect(c.edit(ALICE, { endDate: later }, later).isOk).toBe(true);
    expect(c.toState().startDate).toBe(DAY_START);
    const c2 = okValue(record({ startDate: DAY_START, endDate: DAY_END }));
    expect(c2.edit(ALICE, { startDate: DAY_END }, DAY_END).isOk).toBe(true);
    expect(c2.toState().endDate).toBe(DAY_END);
  });

  it("lets a dated row change its duration alone", () => {
    const c = okValue(record({ startDate: DAY_START, endDate: DAY_END }));
    expect(c.edit(ALICE, { completionTimeMinutes: 30 }, DAY_END).isOk).toBe(
      true,
    );
    expect(c.toState().completionTimeMinutes).toBe(30);
  });
});
