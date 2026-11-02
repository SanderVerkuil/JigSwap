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
const asBob = (t: TestConvex<typeof schema>) =>
  t.withIdentity({ subject: "clerk_bob" });

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

  test.each([
    ["a blank title", { title: "   " }, "InvalidGoalTitle"],
    ["a title past the limit", { title: "x".repeat(101) }, "InvalidGoalTitle"],
    [
      "a description past the limit",
      { description: "x".repeat(1001) },
      "InvalidGoalDescription",
    ],
    ["a start date that isn't a date", { startDate: NaN }, "InvalidGoalPeriod"],
    [
      "an end date that isn't a date",
      { targetDate: 1e20 },
      "InvalidGoalPeriod",
    ],
  ])(
    "a direct call with %s is refused on create and on edit",
    async (_name, invalid, code) => {
      const t = convexTest(schema, modules);
      await seed(t);
      const valid = { title: "Ten", targetCompletions: 10 };
      await expectConvexCode(
        asAlice(t).mutation(api.solving.createGoal.createGoal, {
          ...valid,
          ...invalid,
        }),
        code,
      );

      const goalId = await createGoal(t, { targetCompletions: 5 });
      await expectConvexCode(
        asAlice(t).mutation(api.solving.updateGoal.updateGoal, {
          goalId,
          ...valid,
          ...invalid,
        }),
        code,
      );
      expect((await goalRow(t, goalId))?.targetCompletions).toBe(5);
    },
  );

  test("deleting the solve that reached a goal and logging it again announces it once", async () => {
    const t = convexTest(schema, modules);
    await seed(t);
    const goalId = await createGoal(t, { targetCompletions: 1 });
    const log = () =>
      asAlice(t).mutation(api.solving.recordCompletion.recordCompletion, {
        startDate: NOW - 2 * 60 * 60 * 1000,
        endDate: NOW - 60 * 60 * 1000,
      });
    const achievements = async () =>
      (await eventNames(t)).filter((name) => name === "GoalAchieved").length;

    const { completionId } = await log();
    expect((await goalRow(t, goalId))?.achievementAnnouncedAt).toBe(NOW);
    expect(await achievements()).toBe(1);

    await asAlice(t).mutation(api.solving.deleteCompletion.deleteCompletion, {
      completionId,
    });
    expect((await goalRow(t, goalId))?.currentCompletions).toBe(0);

    await log();
    expect((await goalRow(t, goalId))?.currentCompletions).toBe(1);
    expect(await achievements()).toBe(1);
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

describe("solving.updateGoal", () => {
  test("replaces the definition and recounts for the new period, silently", async () => {
    const t = convexTest(schema, modules);
    const { alice } = await seed(t);
    await insertSolve(t, alice, utc(2026, 2, 1));
    await insertSolve(t, alice, utc(2026, 3, 1));
    const goalId = await createGoal(t, { targetCompletions: 5 });
    expect((await goalRow(t, goalId))?.currentCompletions).toBe(0);

    await asAlice(t).mutation(api.solving.updateGoal.updateGoal, {
      goalId,
      title: "Two this year",
      targetCompletions: 2,
      ...THIS_YEAR,
    });
    expect(await goalRow(t, goalId)).toMatchObject({
      title: "Two this year",
      targetCompletions: 2,
      currentCompletions: 2,
      ...THIS_YEAR,
    });
    expect(await eventNames(t)).toEqual(["GoalCreated"]);
  });

  test("clears what the new definition leaves out", async () => {
    const t = convexTest(schema, modules);
    await seed(t);
    const goalId = await asAlice(t).mutation(
      api.solving.createGoal.createGoal,
      {
        title: "With details",
        description: "Notes",
        targetCompletions: 3,
        ...THIS_YEAR,
      },
    );
    await asAlice(t).mutation(api.solving.updateGoal.updateGoal, {
      goalId,
      title: "Plain",
      targetCompletions: 3,
    });
    const row = await goalRow(t, goalId);
    expect(row?.description).toBeUndefined();
    expect(row?.startDate).toBeUndefined();
    expect(row?.targetDate).toBeUndefined();
  });

  test("another member's goal => NotGoalOwner, unchanged", async () => {
    const t = convexTest(schema, modules);
    await seed(t);
    const goalId = await createGoal(t, { targetCompletions: 5 });
    const before = await goalRow(t, goalId);
    await expectConvexCode(
      asBob(t).mutation(api.solving.updateGoal.updateGoal, {
        goalId,
        title: "Mine now",
        targetCompletions: 1,
      }),
      "NotGoalOwner",
    );
    expect(await goalRow(t, goalId)).toEqual(before);
  });

  test("an unknown goal => GoalNotFound", async () => {
    const t = convexTest(schema, modules);
    await seed(t);
    await expectConvexCode(
      asAlice(t).mutation(api.solving.updateGoal.updateGoal, {
        goalId: "no-such-goal",
        title: "x",
        targetCompletions: 1,
      }),
      "GoalNotFound",
    );
  });

  test("an invalid target => InvalidGoalTarget", async () => {
    const t = convexTest(schema, modules);
    await seed(t);
    const goalId = await createGoal(t, { targetCompletions: 5 });
    await expectConvexCode(
      asAlice(t).mutation(api.solving.updateGoal.updateGoal, {
        goalId,
        title: "x",
        targetCompletions: 2.5,
      }),
      "InvalidGoalTarget",
    );
  });

  test("requires a signed-in member", async () => {
    const t = convexTest(schema, modules);
    await seed(t);
    const goalId = await createGoal(t, { targetCompletions: 5 });
    await expect(
      t.mutation(api.solving.updateGoal.updateGoal, {
        goalId,
        title: "x",
        targetCompletions: 1,
      }),
    ).rejects.toThrow("Unauthenticated");
  });
});

describe("solving.setGoalArchived", () => {
  test("an archived goal stops following solves; restoring recounts it silently", async () => {
    const t = convexTest(schema, modules);
    await seed(t);
    const goalId = await createGoal(t, { targetCompletions: 1 });

    await asAlice(t).mutation(api.solving.setGoalArchived.setGoalArchived, {
      goalId,
      archived: true,
    });
    expect((await goalRow(t, goalId))?.isActive).toBe(false);

    await asAlice(t).mutation(api.solving.recordCompletion.recordCompletion, {
      startDate: NOW - 2 * 60 * 60 * 1000,
      endDate: NOW - 60 * 60 * 1000,
    });
    expect((await goalRow(t, goalId))?.currentCompletions).toBe(0);

    await asAlice(t).mutation(api.solving.setGoalArchived.setGoalArchived, {
      goalId,
      archived: false,
    });
    expect(await goalRow(t, goalId)).toMatchObject({
      isActive: true,
      currentCompletions: 1,
    });
    expect(await eventNames(t)).not.toContain("GoalAchieved");
  });

  test("another member's goal => NotGoalOwner, still active", async () => {
    const t = convexTest(schema, modules);
    await seed(t);
    const goalId = await createGoal(t, { targetCompletions: 5 });
    await expectConvexCode(
      asBob(t).mutation(api.solving.setGoalArchived.setGoalArchived, {
        goalId,
        archived: true,
      }),
      "NotGoalOwner",
    );
    expect((await goalRow(t, goalId))?.isActive).toBe(true);
  });

  test("an unknown goal => GoalNotFound", async () => {
    const t = convexTest(schema, modules);
    await seed(t);
    await expectConvexCode(
      asAlice(t).mutation(api.solving.setGoalArchived.setGoalArchived, {
        goalId: "no-such-goal",
        archived: true,
      }),
      "GoalNotFound",
    );
  });
});

describe("solving.deleteGoal", () => {
  test("the owner deletes the goal for good", async () => {
    const t = convexTest(schema, modules);
    await seed(t);
    const goalId = await createGoal(t, { targetCompletions: 5 });
    await asAlice(t).mutation(api.solving.deleteGoal.deleteGoal, { goalId });
    expect(await goalRow(t, goalId)).toBeNull();
    expect(
      await asAlice(t).query(api.solving.listMyGoals.listMyGoals, {}),
    ).toEqual([]);
  });

  test("another member's goal => NotGoalOwner, kept", async () => {
    const t = convexTest(schema, modules);
    await seed(t);
    const goalId = await createGoal(t, { targetCompletions: 5 });
    await expectConvexCode(
      asBob(t).mutation(api.solving.deleteGoal.deleteGoal, { goalId }),
      "NotGoalOwner",
    );
    expect(await goalRow(t, goalId)).not.toBeNull();
  });

  test("an unknown goal => GoalNotFound", async () => {
    const t = convexTest(schema, modules);
    await seed(t);
    await expectConvexCode(
      asAlice(t).mutation(api.solving.deleteGoal.deleteGoal, {
        goalId: "no-such-goal",
      }),
      "GoalNotFound",
    );
  });
});
