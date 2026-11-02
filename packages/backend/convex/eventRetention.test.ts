import { convexTest, type TestConvex } from "convex-test";
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import { api, internal } from "./_generated/api";
import type { Id } from "./_generated/dataModel";
import { recordEventMembers } from "./events/eventMembers";
import {
  EVENT_RETENTION_DRY_RUN_MAX_PAGES,
  EVENT_RETENTION_MS,
  EVENT_RETENTION_PAGE,
} from "./events/retention";
import { DAY_MS } from "./lib/retention";
import schema from "./schema";
import { FEED_WINDOW_MS } from "./social/activityEntries";

// SEC-71 / PERF-B7: dispatched domain events are deleted once they are older than the activity
// feed reads (FEED_WINDOW_MS) plus a week, by a daily sweep that is a dry run unless
// RETENTION_ENFORCE names "domainEvents". Events still being dispatched, and failed ones an
// operator may replay, are never touched.

const modules = import.meta.glob(["./**/*.{js,ts}", "!./**/*.test.{js,ts}"]);
type T = TestConvex<typeof schema>;

const NOW = Date.UTC(2026, 9, 30, 4, 45);

let lines: string[] = [];
const sweepEvents = () =>
  lines
    .map((line) => JSON.parse(line) as Record<string, unknown>)
    .filter((event) => event.event === "retention.sweep");

beforeEach(() => {
  vi.useFakeTimers({ now: NOW });
  lines = [];
  const capture = (line: unknown) => {
    lines.push(String(line));
  };
  vi.spyOn(console, "log").mockImplementation(capture);
  vi.spyOn(console, "error").mockImplementation(capture);
  vi.stubEnv("AXIOM_API_KEY", "");
});
afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllEnvs();
  vi.restoreAllMocks();
});

const seedAlice = (t: T) =>
  t.run((ctx) =>
    ctx.db.insert("users", {
      clerkId: "clerk_alice",
      email: "alice@example.com",
      name: "alice",
      isActive: true,
      createdAt: 1,
      updatedAt: 1,
    }),
  );

type State = "processed" | "failed" | "pending";

// An event `ageMs` old, dispatched right away (processed), given up on (failed) or still in
// flight, with its lookup rows.
const insertEvent = async (
  t: T,
  ageMs: number,
  state: State,
  payload: Record<string, unknown> = { copyId: "copy-1" },
  name = "CopyMadeAvailable",
): Promise<Id<"domainEvents">> =>
  t.run(async (ctx) => {
    const at = NOW - ageMs;
    const id = await ctx.db.insert("domainEvents", {
      name,
      payload,
      context: "test",
      occurredAt: at,
      ...(state === "processed" && { processedAt: at }),
      ...(state === "failed" && { attempts: 5, failedAt: at }),
    });
    await recordEventMembers(ctx, id, payload);
    return id;
  });

const sweep = async (t: T) => {
  await t.mutation(internal.events.retention.sweepEventRetention, {});
  await t.finishAllScheduledFunctions(vi.runAllTimers);
};

const eventIds = (t: T) =>
  t.run(async (ctx) =>
    (await ctx.db.query("domainEvents").collect()).map((e) => e._id),
  );

const lookupEventIds = (t: T) =>
  t.run(async (ctx) =>
    (await ctx.db.query("domainEventMembers").collect()).map((r) => r.eventId),
  );

describe("domainEvents retention", () => {
  test("keeps events for the feed window plus a week", () => {
    expect(EVENT_RETENTION_MS).toBe(FEED_WINDOW_MS + 7 * DAY_MS);
  });

  test("dry run (RETENTION_ENFORCE unset): an old dispatched event is counted, nothing is deleted", async () => {
    const t = convexTest(schema, modules);
    const old = await insertEvent(t, EVENT_RETENTION_MS + DAY_MS, "processed");

    await sweep(t);

    expect(await eventIds(t)).toEqual([old]);
    expect(
      sweepEvents().map((e) => [e.sweep, e.due, e.acted, e.dry_run, e.is_done]),
    ).toEqual([["domainEvents", 1, 0, true, true]]);
  });

  test("enforced: an old dispatched event goes with its lookup rows; recent, failed and in-flight ones stay", async () => {
    vi.stubEnv("RETENTION_ENFORCE", "domainEvents");
    const t = convexTest(schema, modules);
    const alice = await seedAlice(t);
    const old = await insertEvent(t, EVENT_RETENTION_MS + DAY_MS, "processed", {
      copyId: "copy-1",
      ownerId: alice,
    });
    const recent = await insertEvent(
      t,
      EVENT_RETENTION_MS - DAY_MS,
      "processed",
      { copyId: "copy-2", ownerId: alice },
    );
    const failed = await insertEvent(t, EVENT_RETENTION_MS + DAY_MS, "failed");
    const inFlight = await insertEvent(
      t,
      EVENT_RETENTION_MS + DAY_MS,
      "pending",
    );

    await sweep(t);

    const kept = await eventIds(t);
    expect(kept).not.toContain(old);
    expect(new Set(kept)).toEqual(new Set([recent, failed, inFlight]));
    expect(await lookupEventIds(t)).toEqual([recent]);
    expect(sweepEvents().map((e) => [e.due, e.acted, e.dry_run])).toEqual([
      [1, 1, false],
    ]);
  });

  test("an activity-feed entry inside the feed window survives an enforced sweep", async () => {
    vi.stubEnv("RETENTION_ENFORCE", "all");
    const t = convexTest(schema, modules);
    const alice = await seedAlice(t);
    await t.run((ctx) =>
      ctx.db.insert("completions", {
        aggregateId: "c-recent",
        userId: alice,
        startDate: NOW - FEED_WINDOW_MS,
        photos: [],
        isCompleted: true,
        createdAt: NOW,
        updatedAt: NOW,
      }),
    );
    await insertEvent(
      t,
      FEED_WINDOW_MS - DAY_MS,
      "processed",
      { completionId: "c-recent", userId: alice },
      "CompletionRecorded",
    );
    await insertEvent(
      t,
      EVENT_RETENTION_MS + DAY_MS,
      "processed",
      { completionId: "c-old", userId: alice },
      "CompletionRecorded",
    );

    await sweep(t);

    const feed = await t
      .withIdentity({ subject: "clerk_alice" })
      .query(api.social.getActivityFeed.getActivityFeed, {});
    expect(feed.map((entry) => entry.ref)).toEqual(["c-recent"]);
    expect(await eventIds(t)).toHaveLength(1);
  });

  test("another sweep's name does not enforce it", async () => {
    vi.stubEnv("RETENTION_ENFORCE", "reports, sentPhotos, copyPhotos");
    const t = convexTest(schema, modules);
    const old = await insertEvent(t, EVENT_RETENTION_MS + DAY_MS, "processed");

    await sweep(t);

    expect(await eventIds(t)).toEqual([old]);
  });

  test("a dry run stops after a capped number of pages and says so", async () => {
    const t = convexTest(schema, modules);
    const pages = EVENT_RETENTION_DRY_RUN_MAX_PAGES;
    await t.run(async (ctx) => {
      for (let i = 0; i < EVENT_RETENTION_PAGE * pages + 3; i++) {
        const at = NOW - EVENT_RETENTION_MS - DAY_MS - i;
        await ctx.db.insert("domainEvents", {
          name: "CopyMadeAvailable",
          payload: { copyId: `copy-${i}` },
          context: "test",
          occurredAt: at,
          processedAt: at,
        });
      }
    });

    await sweep(t);

    const events = sweepEvents();
    expect(events).toHaveLength(pages);
    expect(events.at(-1)).toMatchObject({
      is_done: true,
      capped: true,
      dry_run: true,
      due: EVENT_RETENTION_PAGE,
    });
    expect(await eventIds(t)).toHaveLength(EVENT_RETENTION_PAGE * pages + 3);
  });

  test("pages past the page size: the whole backlog goes", async () => {
    vi.stubEnv("RETENTION_ENFORCE", "domainEvents");
    const t = convexTest(schema, modules);
    await t.run(async (ctx) => {
      for (let i = 0; i < EVENT_RETENTION_PAGE + 3; i++) {
        const at = NOW - EVENT_RETENTION_MS - DAY_MS - i;
        await ctx.db.insert("domainEvents", {
          name: "CopyMadeAvailable",
          payload: { copyId: `copy-${i}` },
          context: "test",
          occurredAt: at,
          processedAt: at,
        });
      }
    });

    await sweep(t);

    expect(await eventIds(t)).toEqual([]);
    expect(sweepEvents().map((e) => [e.due, e.acted, e.is_done])).toEqual([
      [EVENT_RETENTION_PAGE, EVENT_RETENTION_PAGE, false],
      [3, 3, true],
    ]);
  });
});
