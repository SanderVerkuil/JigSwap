import { describe, expect, test } from "vitest";
import crons from "./crons";

// Most of the daily crons scan a whole table, so each gets its own minute: started together they add
// needless load at the same moment. A weekly one counts too, on the day it runs.

type Schedule = { type: string; hourUTC?: number; minuteUTC?: number };

const timed = Object.entries(crons.crons).flatMap(([name, job]) => {
  const { type, hourUTC, minuteUTC } = job.schedule as Schedule;
  return type === "daily" || type === "weekly"
    ? [{ name, at: `${hourUTC}:${minuteUTC}` }]
    : [];
});

describe("the timed crons", () => {
  test("cover the ones this is about", () => {
    expect(timed.length).toBeGreaterThan(5);
  });

  test("each start at a minute of their own", () => {
    const sharing = timed.filter(
      (job) => timed.filter((other) => other.at === job.at).length > 1,
    );
    expect(sharing).toEqual([]);
  });

  test("the storage sweep keeps the time the photo moderation runbook names", () => {
    expect(crons.crons["sweep unheld storage blobs"]?.schedule).toMatchObject({
      hourUTC: 4,
      minuteUTC: 15,
    });
  });
});
