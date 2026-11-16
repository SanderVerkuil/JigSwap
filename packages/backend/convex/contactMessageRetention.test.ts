import { convexTest, type TestConvex } from "convex-test";
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import { internal } from "./_generated/api";
import type { Id } from "./_generated/dataModel";
import crons from "./crons";
import { RETENTION_SWEEP_PAGE } from "./lib/retention";
import schema from "./schema";

// ops-3: a handled contact message (the visitor's name, email and text) is deleted 12 months after
// it was sent, by a daily sweep that is a dry run unless RETENTION_ENFORCE is "all" or names
// "contactMessages".
// A message nobody handled yet is never touched.

const modules = import.meta.glob(["./**/*.{js,ts}", "!./**/*.test.{js,ts}"]);
type T = TestConvex<typeof schema>;

const NOW = Date.UTC(2026, 10, 16, 4, 40);
// Sent 12 months and a day before NOW, and 12 months less a day before it.
const PAST_RETENTION = Date.UTC(2025, 10, 15, 4, 40);
const INSIDE_RETENTION = Date.UTC(2025, 10, 17, 4, 40);

let lines: string[] = [];
const sweepEvents = () =>
  lines
    .map((line) => JSON.parse(line) as Record<string, unknown>)
    .filter((event) => event.event === "retention.sweep");

beforeEach(() => {
  vi.useFakeTimers({ now: NOW });
  lines = [];
  vi.spyOn(console, "log").mockImplementation((line: unknown) => {
    lines.push(String(line));
  });
  vi.stubEnv("AXIOM_API_KEY", "");
});
afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllEnvs();
  vi.restoreAllMocks();
});

const insertMessage = (
  t: T,
  createdAt: number,
  status: "new" | "handled",
): Promise<Id<"contactMessages">> =>
  t.run((ctx) =>
    ctx.db.insert("contactMessages", {
      name: "Mara",
      email: "mara@example.com",
      subject: "account",
      message: "Please delete my data.",
      status,
      createdAt,
    }),
  );

const sweep = async (t: T) => {
  await t.mutation(internal.contact.retention.sweepContactMessageRetention, {});
  await t.finishAllScheduledFunctions(vi.runAllTimers);
};

const messageIds = (t: T) =>
  t.run(async (ctx) =>
    (await ctx.db.query("contactMessages").collect()).map((m) => m._id),
  );

describe("contactMessages retention", () => {
  test("runs daily from crons.ts", () => {
    expect(crons.crons["contact message retention"]).toMatchObject({
      name: "contact/retention:sweepContactMessageRetention",
      schedule: { type: "daily" },
    });
  });

  test("dry run (RETENTION_ENFORCE unset): an old handled message is counted, nothing is deleted", async () => {
    const t = convexTest(schema, modules);
    const old = await insertMessage(t, PAST_RETENTION, "handled");

    await sweep(t);

    expect(await messageIds(t)).toEqual([old]);
    expect(
      sweepEvents().map((e) => [e.sweep, e.due, e.acted, e.dry_run, e.is_done]),
    ).toEqual([["contactMessages", 1, 0, true, true]]);
  });

  test("enforced: a handled message past 12 months goes; a recent one and an unhandled old one stay", async () => {
    vi.stubEnv("RETENTION_ENFORCE", "contactMessages");
    const t = convexTest(schema, modules);
    await insertMessage(t, PAST_RETENTION, "handled");
    const recent = await insertMessage(t, INSIDE_RETENTION, "handled");
    const unhandled = await insertMessage(t, PAST_RETENTION, "new");

    await sweep(t);

    expect(new Set(await messageIds(t))).toEqual(new Set([recent, unhandled]));
    expect(sweepEvents().map((e) => [e.due, e.acted, e.dry_run])).toEqual([
      [1, 1, false],
    ]);
  });

  // Calendar months, not 365 days: 12 months before 1 March 2028 is 1 March 2027, a 366-day span
  // across 29 February 2028. A message sent half a day after that cutoff is still inside.
  test("counts calendar months: across 29 February a message just inside 12 months stays", async () => {
    vi.setSystemTime(Date.UTC(2028, 2, 1, 4, 40));
    vi.stubEnv("RETENTION_ENFORCE", "contactMessages");
    const t = convexTest(schema, modules);
    await insertMessage(t, Date.UTC(2027, 1, 28, 16, 40), "handled");
    const inside = await insertMessage(
      t,
      Date.UTC(2027, 2, 1, 16, 40),
      "handled",
    );

    await sweep(t);

    expect(await messageIds(t)).toEqual([inside]);
  });

  test('RETENTION_ENFORCE "all" enforces it; another sweep\'s name does not', async () => {
    vi.stubEnv("RETENTION_ENFORCE", "reports, domainEvents");
    const t = convexTest(schema, modules);
    const old = await insertMessage(t, PAST_RETENTION, "handled");

    await sweep(t);
    expect(await messageIds(t)).toEqual([old]);

    vi.stubEnv("RETENTION_ENFORCE", "all");
    await sweep(t);
    expect(await messageIds(t)).toEqual([]);
  });

  test("pages past the page size: the whole backlog goes", async () => {
    vi.stubEnv("RETENTION_ENFORCE", "contactMessages");
    const t = convexTest(schema, modules);
    for (let i = 0; i < RETENTION_SWEEP_PAGE + 3; i++) {
      await insertMessage(t, PAST_RETENTION - i, "handled");
    }

    await sweep(t);

    expect(await messageIds(t)).toEqual([]);
    expect(sweepEvents().map((e) => [e.due, e.acted, e.is_done])).toEqual([
      [RETENTION_SWEEP_PAGE, RETENTION_SWEEP_PAGE, false],
      [3, 3, true],
    ]);
  });
});
