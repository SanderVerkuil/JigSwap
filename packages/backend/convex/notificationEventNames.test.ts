import { readFileSync } from "node:fs";
import { describe, expect, test } from "vitest";
import { NOTIFYING_EVENT_NAMES } from "./notifications/subscriber";

// PERF-B7: events/dispatch runs the Notifications handler only for NOTIFYING_EVENT_NAMES, so an
// event no notification is about opens no sub-transaction. The list must name exactly the events
// the subscriber's translate switch handles: a case missing from it would never be dispatched to
// Notifications, so its notifications would silently stop.

// The `case "<EventName>":` labels of translate's switch, read from the source.
const translateCaseLabels = (): string[] => {
  const source = readFileSync(
    new URL("./notifications/subscriber.ts", import.meta.url),
    "utf8",
  );
  const start = source.indexOf("const translate = async");
  expect(start).toBeGreaterThan(-1);
  const body = source.slice(start);
  const end = body.indexOf("\n};\n");
  expect(end).toBeGreaterThan(-1);
  return [...body.slice(0, end).matchAll(/case "(\w+)":/g)].map((m) => m[1]);
};

describe("NOTIFYING_EVENT_NAMES", () => {
  test("lists exactly the events the Notifications subscriber translates", () => {
    const labels = translateCaseLabels();
    expect(labels.length).toBeGreaterThan(0);
    expect([...NOTIFYING_EVENT_NAMES].sort()).toEqual([...labels].sort());
  });

  test("names each event once", () => {
    expect(new Set(NOTIFYING_EVENT_NAMES).size).toBe(
      NOTIFYING_EVENT_NAMES.length,
    );
  });
});
