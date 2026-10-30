import { convexTest, type TestConvex } from "convex-test";
import { ConvexError, type Value } from "convex/values";
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import { api } from "./_generated/api";
import type { Id } from "./_generated/dataModel";
import schema from "./schema";

const modules = import.meta.glob(["./**/*.{js,ts}", "!./**/*.test.{js,ts}"]);

// Goals count solves by UTC calendar day, so the clock is pinned (Date only; timers stay real).
const NOW = Date.UTC(2026, 5, 15, 12); // 15 June 2026, 12:00 UTC
const DAY = 24 * 60 * 60 * 1000;
const utc = (y: number, m: number, d: number, h = 0) =>
  Date.UTC(y, m - 1, d, h);
const THIS_YEAR = { startDate: utc(2026, 1, 1), targetDate: utc(2026, 12, 31) };

beforeEach(() => {
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(NOW);
});
afterEach(() => {
  vi.useRealTimers();
});

const seed = (t: TestConvex<typeof schema>) =>
  t.run(async (ctx) => {
    const user = (clerkId: string) =>
      ctx.db.insert("users", {
        clerkId,
        email: `${clerkId}@example.com`,
        name: clerkId,
        isActive: true,
        createdAt: NOW,
        updatedAt: NOW,
      });
    return { alice: await user("clerk_alice"), bob: await user("clerk_bob") };
  });

const asAlice = (t: TestConvex<typeof schema>) =>
  t.withIdentity({ subject: "clerk_alice" });

// A finished solve stored the way the domain path stores it. `aggregateId: null` stores a legacy
// row (written before the domain path, no aggregateId).
const insertSolve = (
  t: TestConvex<typeof schema>,
  userId: Id<"users">,
  endDate: number,
  options: {
    datePrecision?: "year" | "unknown";
    aggregateId?: string | null;
  } = {},
) =>
  t.run(async (ctx) => {
    const aggregateId =
      options.aggregateId === null
        ? undefined
        : (options.aggregateId ?? crypto.randomUUID());
    await ctx.db.insert("completions", {
      aggregateId,
      userId,
      startDate: endDate,
      endDate,
      completionTimeMinutes: options.datePrecision ? undefined : 60,
      photos: [],
      isCompleted: true,
      datePrecision: options.datePrecision,
      createdAt: endDate,
      updatedAt: endDate,
    });
    return aggregateId;
  });

const createGoal = (
  t: TestConvex<typeof schema>,
  args: {
    targetCompletions: number;
    startDate?: number;
    targetDate?: number;
  },
) =>
  asAlice(t).mutation(api.solving.createGoal.createGoal, {
    title: "My goal",
    ...args,
  }) as Promise<string>;

const goalRow = (t: TestConvex<typeof schema>, aggregateId: string) =>
  t.run(async (ctx) =>
    ctx.db
      .query("goals")
      .withIndex("by_aggregate_id", (q) => q.eq("aggregateId", aggregateId))
      .unique(),
  );

const eventNames = (t: TestConvex<typeof schema>) =>
  t.run(async (ctx) =>
    (await ctx.db.query("domainEvents").collect()).map((e) => e.name),
  );

// convex-test serializes ConvexError.data to a JSON string at the function boundary; normalise.
const dataOf = (e: unknown): { code?: string } => {
  const data = (e as ConvexError<Value>).data;
  return typeof data === "string"
    ? JSON.parse(data)
    : (data as { code?: string });
};

const expectConvexCode = async (p: Promise<unknown>, code: string) => {
  await expect(p).rejects.toBeInstanceOf(ConvexError);
  await p.catch((e: unknown) => {
    expect(dataOf(e).code).toBe(code);
  });
};

describe("goals count the solves inside their period", () => {
  test("a new goal ignores earlier solves: 30 solves before today give 0/10", async () => {
    const t = convexTest(schema, modules);
    const { alice } = await seed(t);
    for (let i = 1; i <= 30; i++) await insertSolve(t, alice, NOW - i * DAY);

    const goalId = await createGoal(t, { targetCompletions: 10 });
    expect((await goalRow(t, goalId))?.currentCompletions).toBe(0);

    // The next solve makes it 1/10, not 31/10 "achieved".
    await asAlice(t).mutation(api.solving.recordCompletion.recordCompletion, {
      startDate: NOW - 2 * 60 * 60 * 1000,
      endDate: NOW - 60 * 60 * 1000,
    });
    expect((await goalRow(t, goalId))?.currentCompletions).toBe(1);
    expect(await eventNames(t)).not.toContain("GoalAchieved");
  });

  test("a this-year goal starts at this year's solves, without announcing an achievement", async () => {
    const t = convexTest(schema, modules);
    const { alice, bob } = await seed(t);
    await insertSolve(t, alice, utc(2026, 1, 1)); // first day counts
    await insertSolve(t, alice, utc(2026, 3, 10, 18));
    await insertSolve(t, alice, utc(2026, 7, 1, 12), { datePrecision: "year" });
    await insertSolve(t, alice, utc(2026, 5, 1), { aggregateId: null }); // legacy row
    await insertSolve(t, alice, utc(2025, 12, 31, 23)); // before the period
    await insertSolve(t, alice, utc(2025, 7, 1, 12), { datePrecision: "year" });
    await insertSolve(t, alice, NOW, { datePrecision: "unknown" });
    await insertSolve(t, bob, utc(2026, 4, 1)); // someone else's

    const goalId = await createGoal(t, {
      targetCompletions: 4,
      ...THIS_YEAR,
    });
    const row = await goalRow(t, goalId);
    expect(row).toMatchObject({
      currentCompletions: 4,
      startDate: THIS_YEAR.startDate,
      targetDate: THIS_YEAR.targetDate,
    });
    expect(await eventNames(t)).toEqual(["GoalCreated"]);

    const [listed] = await asAlice(t).query(
      api.solving.listMyGoals.listMyGoals,
      {},
    );
    expect(listed).toMatchObject({
      startDate: THIS_YEAR.startDate,
      isAchieved: true,
    });
  });

  test("a period that ends before it starts => InvalidGoalPeriod", async () => {
    const t = convexTest(schema, modules);
    await seed(t);
    await expectConvexCode(
      createGoal(t, {
        targetCompletions: 3,
        startDate: THIS_YEAR.targetDate,
        targetDate: THIS_YEAR.startDate,
      }),
      "InvalidGoalPeriod",
    );
  });

  test("editing a solve's date out of the period lowers the goal", async () => {
    const t = convexTest(schema, modules);
    const { alice } = await seed(t);
    const goalId = await createGoal(t, { targetCompletions: 3 });
    await insertSolve(t, alice, NOW - 1000, { aggregateId: "today" });
    // Recording happens through the domain path in the app; here an edit triggers the recompute.
    await asAlice(t).mutation(api.solving.editCompletion.editCompletion, {
      completionId: "today",
      notes: "first",
    });
    expect((await goalRow(t, goalId))?.currentCompletions).toBe(1);

    const lastMonth = utc(2026, 5, 10);
    await asAlice(t).mutation(api.solving.editCompletion.editCompletion, {
      completionId: "today",
      startDate: lastMonth,
      endDate: lastMonth,
    });
    expect((await goalRow(t, goalId))?.currentCompletions).toBe(0);
  });
});
