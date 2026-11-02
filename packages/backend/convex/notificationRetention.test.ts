import { convexTest, type TestConvex } from "convex-test";
import { getFunctionName } from "convex/server";
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import { internal } from "./_generated/api";
import type { Id } from "./_generated/dataModel";
import crons from "./crons";
import {
  DRY_RUN_MAX_PAGES,
  RETENTION_SWEEP_PAGE,
} from "./notifications/retention";
import schema from "./schema";

// Bundle every Convex module for the in-memory runtime, excluding test files.
const modules = import.meta.glob(["./**/*.{js,ts}", "!./**/*.test.{js,ts}"]);

type T = TestConvex<typeof schema>;

const DAY = 24 * 60 * 60 * 1000;

const seedMember = (t: T, clerkId: string) =>
  t.run((ctx) =>
    ctx.db.insert("users", {
      clerkId,
      email: `${clerkId}@example.com`,
      name: clerkId,
      isActive: true,
      createdAt: Date.now(),
      updatedAt: Date.now(),
    }),
  );

type Seed = {
  label: string;
  ageDays: number;
  isRead: boolean;
  // Days since a grouped row last absorbed an actor (updatedAt); absent = never grouped.
  touchedDaysAgo?: number;
};

// Insert notifications with the given ages; returns their ids by label.
const seedRows = (t: T, userId: Id<"users">, rows: Seed[]) =>
  t.run(async (ctx) => {
    const now = Date.now();
    const ids: Record<string, Id<"notifications">> = {};
    for (const row of rows) {
      ids[row.label] = await ctx.db.insert("notifications", {
        aggregateId: crypto.randomUUID(),
        channel: "inApp",
        userId,
        type: "new_follower",
        isRead: row.isRead,
        createdAt: now - row.ageDays * DAY,
        ...(row.touchedDaysAgo !== undefined
          ? { groupKey: "g", updatedAt: now - row.touchedDaysAgo * DAY }
          : {}),
      });
    }
    return ids;
  });

const remaining = (t: T) =>
  t.run(async (ctx) => (await ctx.db.query("notifications").collect()).length);

const exists = (t: T, id: Id<"notifications">) =>
  t.run(async (ctx) => (await ctx.db.get(id)) !== null);

// Run the sweep the way the cron does, drain its self-scheduled pages, and return the wide events
// named `event` it logged (by default the one per-run event logged at the end).
const sweep = async (
  t: T,
  args: { mode?: "dry-run" | "delete" } = {},
  event = "notifications.retentionSweep",
) => {
  const log = vi.spyOn(console, "log").mockImplementation(() => {});
  vi.useFakeTimers();
  try {
    await t.mutation(
      internal.notifications.retention.sweepExpiredNotifications,
      args,
    );
    await t.finishAllScheduledFunctions(vi.runAllTimers);
    const events = log.mock.calls
      .map(([line]) => (typeof line === "string" ? line : ""))
      .filter((line) => line.includes(`"${event}"`))
      .map((line) => JSON.parse(line) as Record<string, unknown>);
    return events;
  } finally {
    vi.useRealTimers();
    log.mockRestore();
  }
};

// Deleting takes both the "delete" mode and the shared RETENTION_ENFORCE switch.
const sweepDeleting = (t: T, event?: string) => {
  vi.stubEnv("RETENTION_ENFORCE", "notifications");
  return sweep(t, { mode: "delete" }, event);
};

const MIXED: Seed[] = [
  { label: "freshRead", ageDays: 10, isRead: true },
  { label: "freshUnread", ageDays: 10, isRead: false },
  { label: "oldRead", ageDays: 200, isRead: true }, // read, past 180 days: expired
  { label: "oldUnread", ageDays: 200, isRead: false }, // unread, under 365 days: kept
  { label: "ancientUnread", ageDays: 400, isRead: false }, // past 365 days: expired
  { label: "ancientRead", ageDays: 400, isRead: true }, // expired
  // A grouped row created long ago that absorbed an actor recently is live: kept.
  { label: "groupedRecent", ageDays: 400, isRead: false, touchedDaysAgo: 5 },
  {
    label: "groupedReadRecent",
    ageDays: 300,
    isRead: true,
    touchedDaysAgo: 90,
  },
];

beforeEach(() => {
  // The final event is forwarded to Axiom by a scheduled action: keep it a no-op in tests.
  vi.stubEnv("AXIOM_API_KEY", "");
});
afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllEnvs();
});

describe("notification retention sweep", () => {
  test("dry run (the default) deletes nothing and logs would-delete counts", async () => {
    const t = convexTest(schema, modules);
    const ann = await seedMember(t, "clerk_ann");
    await seedRows(t, ann, MIXED);

    const events = await sweep(t);

    expect(await remaining(t)).toBe(MIXED.length);
    expect(events).toHaveLength(1);
    expect(events[0]).toMatchObject({
      outcome: "success",
      mode: "dry-run",
      expired_read: 2,
      expired_unread: 1,
      deleted: 0,
      read_retention_days: 180,
      unread_retention_days: 365,
    });
  });

  test("delete mode removes only the expired rows", async () => {
    const t = convexTest(schema, modules);
    const ann = await seedMember(t, "clerk_ann");
    const ids = await seedRows(t, ann, MIXED);

    const events = await sweepDeleting(t);

    const expired = new Set(["oldRead", "ancientUnread", "ancientRead"]);
    for (const { label } of MIXED) {
      expect(await exists(t, ids[label]!), label).toBe(!expired.has(label));
    }
    expect(events[0]).toMatchObject({
      mode: "delete",
      expired_read: 2,
      expired_unread: 1,
      deleted: 3,
    });
  });

  test.each([undefined, "reports, domainEvents"])(
    'mode "delete" stays a dry run unless RETENTION_ENFORCE enables it (%s)',
    async (enforce) => {
      const t = convexTest(schema, modules);
      const ann = await seedMember(t, "clerk_ann");
      await seedRows(t, ann, MIXED);
      if (enforce) vi.stubEnv("RETENTION_ENFORCE", enforce);

      const events = await sweep(t, { mode: "delete" });

      expect(await remaining(t)).toBe(MIXED.length);
      expect(events[0]).toMatchObject({
        mode: "dry-run",
        expired_read: 2,
        expired_unread: 1,
        deleted: 0,
      });
    },
  );

  test('RETENTION_ENFORCE "all" deletes nothing while the cron passes "dry-run"', async () => {
    const t = convexTest(schema, modules);
    const ann = await seedMember(t, "clerk_ann");
    await seedRows(t, ann, MIXED);
    vi.stubEnv("RETENTION_ENFORCE", "all");

    const events = await sweep(t, { mode: "dry-run" });

    expect(await remaining(t)).toBe(MIXED.length);
    expect(events[0]).toMatchObject({ mode: "dry-run", deleted: 0 });
  });

  test('RETENTION_ENFORCE "all" enables a "delete" run', async () => {
    const t = convexTest(schema, modules);
    const ann = await seedMember(t, "clerk_ann");
    await seedRows(t, ann, MIXED);
    vi.stubEnv("RETENTION_ENFORCE", "all");

    const events = await sweep(t, { mode: "delete" });

    expect(await remaining(t)).toBe(MIXED.length - 3);
    expect(events[0]).toMatchObject({ mode: "delete", deleted: 3 });
  });

  test("every page logs the shared retention.sweep event", async () => {
    const t = convexTest(schema, modules);
    const ann = await seedMember(t, "clerk_ann");
    await seedRows(
      t,
      ann,
      Array.from({ length: RETENTION_SWEEP_PAGE + 1 }, (_, i) => ({
        label: `r${i}`,
        ageDays: 200,
        isRead: true,
      })),
    );

    const dryRun = await sweep(t, {}, "retention.sweep");
    expect(dryRun).toHaveLength(2);
    expect(dryRun[0]).toMatchObject({
      sweep: "notifications",
      due: RETENTION_SWEEP_PAGE,
      acted: 0,
      dry_run: true,
      is_done: false,
    });
    expect(dryRun[1]).toMatchObject({
      due: 1,
      acted: 0,
      dry_run: true,
      is_done: true,
    });

    const deleting = await sweepDeleting(t, "retention.sweep");
    expect(deleting).toHaveLength(2);
    expect(deleting[0]).toMatchObject({
      sweep: "notifications",
      due: RETENTION_SWEEP_PAGE,
      acted: RETENTION_SWEEP_PAGE,
      dry_run: false,
      is_done: false,
    });
    expect(deleting[1]).toMatchObject({
      due: 1,
      acted: 1,
      dry_run: false,
      is_done: true,
    });
  });

  test("the sweep pages through the old rows and finishes with one event", async () => {
    const t = convexTest(schema, modules);
    const ann = await seedMember(t, "clerk_ann");
    const ben = await seedMember(t, "clerk_ben");
    const old = (n: number, isRead: boolean): Seed[] =>
      Array.from({ length: n }, (_, i) => ({
        label: `${isRead ? "r" : "u"}${i}`,
        ageDays: 190 + (i % 50),
        isRead,
      }));
    await seedRows(t, ann, old(300, true));
    await seedRows(t, ben, old(150, true));
    await seedRows(t, ben, old(60, false)); // unread under a year: kept

    const events = await sweepDeleting(t);

    expect(await remaining(t)).toBe(60);
    expect(events).toHaveLength(1);
    expect(events[0]).toMatchObject({
      scanned: 510,
      expired_read: 450,
      expired_unread: 0,
      deleted: 450,
    });
    // 510 old rows at 200 a page.
    expect(events[0]!.pages).toBe(3);
  });

  test("a dry run stops after DRY_RUN_MAX_PAGES and reports a capped sample", async () => {
    const t = convexTest(schema, modules);
    const ann = await seedMember(t, "clerk_ann");
    const rows = DRY_RUN_MAX_PAGES * RETENTION_SWEEP_PAGE + 50;
    await seedRows(
      t,
      ann,
      Array.from({ length: rows }, (_, i) => ({
        label: `r${i}`,
        ageDays: 200,
        isRead: true,
      })),
    );

    const events = await sweep(t);

    expect(await remaining(t)).toBe(rows);
    expect(events).toHaveLength(1);
    expect(events[0]).toMatchObject({
      mode: "dry-run",
      capped: true,
      pages: DRY_RUN_MAX_PAGES,
      scanned: DRY_RUN_MAX_PAGES * RETENTION_SWEEP_PAGE,
      expired_read: DRY_RUN_MAX_PAGES * RETENTION_SWEEP_PAGE,
      deleted: 0,
    });
  });

  test("delete mode is not capped: it pages through the whole backlog", async () => {
    const t = convexTest(schema, modules);
    const ann = await seedMember(t, "clerk_ann");
    const rows = DRY_RUN_MAX_PAGES * RETENTION_SWEEP_PAGE + 50;
    await seedRows(
      t,
      ann,
      Array.from({ length: rows }, (_, i) => ({
        label: `r${i}`,
        ageDays: 200,
        isRead: true,
      })),
    );

    const events = await sweepDeleting(t);

    expect(await remaining(t)).toBe(0);
    expect(events[0]).toMatchObject({
      mode: "delete",
      capped: false,
      deleted: rows,
    });
  });

  test("the run's wide event is handed to the Axiom forwarder", async () => {
    const t = convexTest(schema, modules);
    const ann = await seedMember(t, "clerk_ann");
    await seedRows(t, ann, MIXED);

    await sweep(t);

    const forwarded = await t.run(async (ctx) =>
      (await ctx.db.system.query("_scheduled_functions").collect()).filter(
        (job) =>
          job.name ===
          getFunctionName(internal.events.ingestDispatchFailure.ingest),
      ),
    );
    expect(forwarded).toHaveLength(1);
    expect(forwarded[0]!.args[0]).toMatchObject({
      line: {
        event: "notifications.retentionSweep",
        mode: "dry-run",
        expired_read: 2,
        expired_unread: 1,
      },
    });
  });

  test("nothing old: one page, nothing expired", async () => {
    const t = convexTest(schema, modules);
    const ann = await seedMember(t, "clerk_ann");
    await seedRows(t, ann, [
      { label: "a", ageDays: 1, isRead: true },
      { label: "b", ageDays: 100, isRead: true },
    ]);

    const events = await sweepDeleting(t);

    expect(await remaining(t)).toBe(2);
    expect(events[0]).toMatchObject({ scanned: 0, deleted: 0, pages: 1 });
  });
});

describe("notification retention cron", () => {
  const sweepJobs = () =>
    Object.values(crons.crons).filter(
      (job) =>
        job.name ===
        getFunctionName(
          internal.notifications.retention.sweepExpiredNotifications,
        ),
    );

  test("runs weekly and ONLY as a dry run until the owner approves deleting", () => {
    // Switching to "delete" is an owner decision (retention periods + a privacy-policy line):
    // this test must change in that same reviewed change, never as a side effect.
    expect(sweepJobs()).toHaveLength(1);
    expect(sweepJobs()[0]!.args).toEqual([{ mode: "dry-run" }]);
    expect(sweepJobs()[0]!.schedule).toMatchObject({ type: "weekly" });
  });
});
