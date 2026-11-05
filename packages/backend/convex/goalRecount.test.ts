import { convexTest, type TestConvex } from "convex-test";
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import { internal } from "./_generated/api";
import type { Doc, Id } from "./_generated/dataModel";
import schema from "./schema";
import { RECOUNT_GOALS_BATCH } from "./solving/recountGoals";

const modules = import.meta.glob(["./**/*.{js,ts}", "!./**/*.test.{js,ts}"]);

// The one-shot recount brings every goal to the number of its member's finished solves inside the
// goal's own period. Goals from before periods existed held lifetime totals.

const NOW = Date.UTC(2026, 9, 30, 12); // 30 October 2026, 12:00 UTC
const utc = (y: number, m: number, d: number, h = 0) =>
  Date.UTC(y, m - 1, d, h);
const CREATED = utc(2026, 10, 1, 9); // the legacy goals were set on 1 October

const recount = internal.solving.recountGoals.recountGoals;

beforeEach(() => {
  vi.spyOn(console, "log").mockImplementation(() => {});
});
afterEach(() => {
  vi.restoreAllMocks();
  vi.useRealTimers();
});

const insertUser = (t: TestConvex<typeof schema>, name: string) =>
  t.run((ctx) =>
    ctx.db.insert("users", {
      clerkId: `clerk_${name}`,
      email: `${name}@example.com`,
      name,
      isActive: true,
      createdAt: CREATED,
      updatedAt: CREATED,
    }),
  );

const insertSolve = (
  t: TestConvex<typeof schema>,
  userId: Id<"users">,
  endDate: number,
  datePrecision?: "year" | "unknown",
) =>
  t.run(async (ctx) => {
    await ctx.db.insert("completions", {
      aggregateId: crypto.randomUUID(),
      userId,
      startDate: endDate,
      endDate,
      photos: [],
      isCompleted: true,
      datePrecision,
      createdAt: endDate,
      updatedAt: endDate,
    });
  });

const insertGoal = (
  t: TestConvex<typeof schema>,
  userId: Id<"users">,
  extra: Partial<Doc<"goals">> = {},
) =>
  t.run((ctx) =>
    ctx.db.insert("goals", {
      aggregateId: crypto.randomUUID(),
      userId,
      title: "Solve 10",
      targetCompletions: 10,
      currentCompletions: 0,
      isActive: true,
      createdAt: CREATED,
      updatedAt: CREATED,
      ...extra,
    }),
  );

const goals = (t: TestConvex<typeof schema>, ids: Id<"goals">[]) =>
  t.run(async (ctx) => Promise.all(ids.map((id) => ctx.db.get(id))));

const eventCount = (t: TestConvex<typeof schema>) =>
  t.run(async (ctx) => (await ctx.db.query("domainEvents").collect()).length);

// Run the first batch, then drain the self-rescheduled ones.
const runAll = async (
  t: TestConvex<typeof schema>,
  args: { dryRun?: boolean } = {},
) => {
  vi.useFakeTimers({ now: NOW });
  try {
    const first = await t.mutation(recount, args);
    await t.finishAllScheduledFunctions(vi.runAllTimers);
    return first;
  } finally {
    vi.useRealTimers();
  }
};

// Alice has 31 solves over the years (30 before October, 1 in October) and one 2026 import; her
// legacy goal shows the lifetime 32. Bob's goal is already right.
const seedLifetimeInflated = async (t: TestConvex<typeof schema>) => {
  const alice = await insertUser(t, "alice");
  const bob = await insertUser(t, "bob");
  for (let i = 1; i <= 30; i++) await insertSolve(t, alice, utc(2025, 1, i));
  await insertSolve(t, alice, utc(2026, 10, 12, 20));
  await insertSolve(t, alice, utc(2026, 7, 1, 12), "year");
  await insertSolve(t, alice, utc(2026, 10, 20), "unknown");
  const inflated = await insertGoal(t, alice, { currentCompletions: 32 });
  const thisYear = await insertGoal(t, alice, {
    currentCompletions: 32,
    startDate: utc(2026, 1, 1),
    targetDate: utc(2026, 12, 31),
  });
  const legacy = await insertGoal(t, alice, {
    aggregateId: undefined,
    currentCompletions: 32,
  });
  const archived = await insertGoal(t, alice, {
    currentCompletions: 32,
    isActive: false,
  });
  await insertSolve(t, bob, utc(2026, 10, 2));
  const correct = await insertGoal(t, bob, { currentCompletions: 1 });
  return { inflated, thisYear, legacy, archived, correct };
};

describe("solving.recountGoals", () => {
  test("lowers lifetime totals to the period count, silently and without touching updatedAt", async () => {
    const t = convexTest(schema, modules);
    const ids = await seedLifetimeInflated(t);
    const before = await goals(t, Object.values(ids));

    const first = await runAll(t);
    expect(first).toEqual({ scanned: 5, changed: 4 });

    const [inflated, thisYear, legacy, archived, correct] = await goals(
      t,
      Object.values(ids),
    );
    // From 1 October: the October solve and the 2026 import (year overlap).
    expect(inflated?.currentCompletions).toBe(2);
    // The whole of 2026: the same two; the 2025 solves stay out.
    expect(thisYear?.currentCompletions).toBe(2);
    expect(legacy?.currentCompletions).toBe(2);
    expect(archived?.currentCompletions).toBe(2);
    expect(correct).toEqual(before[4]);
    expect(inflated).toEqual({ ...before[0], currentCompletions: 2 });
    // No GoalProgressed / GoalAchieved: nobody is notified about a correction.
    expect(await eventCount(t)).toBe(0);
  });

  test("a second run changes nothing", async () => {
    const t = convexTest(schema, modules);
    const ids = await seedLifetimeInflated(t);
    await runAll(t);
    const after = await goals(t, Object.values(ids));

    expect(await runAll(t)).toEqual({ scanned: 5, changed: 0 });
    expect(await goals(t, Object.values(ids))).toEqual(after);
  });

  test("a dry run reports the changes and writes nothing", async () => {
    const t = convexTest(schema, modules);
    const ids = await seedLifetimeInflated(t);
    const before = await goals(t, Object.values(ids));

    expect(await runAll(t, { dryRun: true })).toEqual({
      scanned: 5,
      changed: 4,
    });
    expect(await goals(t, Object.values(ids))).toEqual(before);
  });

  test("reaches every page", async () => {
    const t = convexTest(schema, modules);
    const alice = await insertUser(t, "alice");
    await insertSolve(t, alice, utc(2025, 3, 1));
    const ids: Id<"goals">[] = [];
    for (let i = 0; i < RECOUNT_GOALS_BATCH + 20; i++) {
      ids.push(await insertGoal(t, alice, { currentCompletions: 1 }));
    }

    const first = await runAll(t);
    expect(first).toEqual({
      scanned: RECOUNT_GOALS_BATCH,
      changed: RECOUNT_GOALS_BATCH,
    });
    const after = await goals(t, ids);
    expect(after.every((goal) => goal?.currentCompletions === 0)).toBe(true);
  });
});
