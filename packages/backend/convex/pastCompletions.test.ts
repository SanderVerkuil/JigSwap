import { convexTest, type TestConvex } from "convex-test";
import { ConvexError, type Value } from "convex/values";
import { describe, expect, test } from "vitest";
import { api } from "./_generated/api";
import type { Id } from "./_generated/dataModel";
import schema from "./schema";

// Completion date precision + the bulk "I've solved these" path (spec 2026-10-17 §3.2, §4).
const modules = import.meta.glob(["./**/*.{js,ts}", "!./**/*.test.{js,ts}"]);

type T = TestConvex<typeof schema>;

const DAY = 24 * 60 * 60 * 1000;

const insertUser = (t: T, name: string) =>
  t.run(async (ctx) => {
    const now = Date.now();
    return ctx.db.insert("users", {
      clerkId: `clerk_${name}`,
      email: `${name}@example.com`,
      name,
      isActive: true,
      createdAt: now,
      updatedAt: now,
    });
  });

const as = (t: T, name: string) => t.withIdentity({ subject: `clerk_${name}` });

// A catalog puzzle plus a copy of it owned by `ownerId`; returns the copy's aggregateId.
const insertCopy = (t: T, ownerId: Id<"users">, title: string) =>
  t.run(async (ctx) => {
    const now = Date.now();
    const puzzleAggregateId = crypto.randomUUID();
    const puzzleId = await ctx.db.insert("puzzles", {
      aggregateId: puzzleAggregateId,
      title,
      brand: "Ravensburger",
      pieceCount: 1000,
      searchableText: title,
      status: "approved",
      submittedBy: ownerId,
      createdAt: now,
      updatedAt: now,
    });
    const copyAggregateId = crypto.randomUUID();
    const copyId = await ctx.db.insert("ownedPuzzles", {
      aggregateId: copyAggregateId,
      puzzleDefinitionId: puzzleAggregateId,
      puzzleId,
      ownerId,
      condition: "good",
      availability: { forTrade: false, forSale: false, forLend: false },
      visibility: "private",
      snapshot: { title, brand: "Ravensburger", pieceCount: 1000 },
      createdAt: now,
      updatedAt: now,
    });
    return { copyAggregateId, copyId, puzzleId };
  });

const seed = async (t: T) => {
  const alice = await insertUser(t, "alice");
  const bob = await insertUser(t, "bob");
  const carol = await insertUser(t, "carol");
  const a1 = await insertCopy(t, alice, "Mountain Lake");
  const a2 = await insertCopy(t, alice, "Cats");
  const a3 = await insertCopy(t, alice, "Harbour");
  const c1 = await insertCopy(t, carol, "Carol's Castle");
  return { alice, bob, carol, a1, a2, a3, c1 };
};

const rowsOf = (t: T, userId: Id<"users">) =>
  t.run((ctx) =>
    ctx.db
      .query("completions")
      .withIndex("by_user", (q) => q.eq("userId", userId))
      .collect(),
  );

const rowByAggregate = (t: T, aggregateId: string) =>
  t.run((ctx) =>
    ctx.db
      .query("completions")
      .withIndex("by_aggregate_id", (q) => q.eq("aggregateId", aggregateId))
      .unique(),
  );

const dataOf = (e: unknown): { code?: string } => {
  const data = (e as ConvexError<Value>).data;
  return typeof data === "string"
    ? JSON.parse(data)
    : (data as { code?: string });
};

const expectConvexCode = async (p: Promise<unknown>, code: string) => {
  await expect(p).rejects.toBeInstanceOf(ConvexError);
  await p.catch((e: unknown) => expect(dataOf(e).code).toBe(code));
};

const follow = (t: T, followerId: Id<"users">, followeeId: Id<"users">) =>
  t.run(async (ctx) => {
    await ctx.db.insert("follows", {
      followerId,
      followeeId,
      createdAt: Date.now(),
    });
  });

const recordPast = (
  t: T,
  who: string,
  items: {
    copyId: string;
    datePrecision: "day" | "year" | "unknown";
    date?: number;
    year?: number;
  }[],
) =>
  as(t, who).mutation(api.solving.recordPastCompletions.recordPastCompletions, {
    items,
  });

describe("solving.recordPastCompletions", () => {
  test("rejects an unauthenticated caller", async () => {
    const t = convexTest(schema, modules);
    const { a1 } = await seed(t);
    await expect(
      t.mutation(api.solving.recordPastCompletions.recordPastCompletions, {
        items: [{ copyId: a1.copyAggregateId, datePrecision: "unknown" }],
      }),
    ).rejects.toThrow();
  });

  test("logs finished solves at each precision with sentinels, snapshots and no duration", async () => {
    const t = convexTest(schema, modules);
    const { alice, a1, a2, a3 } = await seed(t);
    const picked = Date.UTC(2025, 2, 14);
    const before = Date.now();
    const { completionIds } = await recordPast(t, "alice", [
      { copyId: a1.copyAggregateId, datePrecision: "day", date: picked },
      { copyId: a2.copyAggregateId, datePrecision: "year", year: 2023 },
      { copyId: a3.copyAggregateId, datePrecision: "unknown" },
    ]);
    expect(completionIds).toHaveLength(3);

    const [day, year, unknown] = await Promise.all(
      completionIds.map((id) => rowByAggregate(t, id)),
    );
    // "day" is stored as absent: legacy and new dated rows are indistinguishable.
    expect(day?.datePrecision).toBeUndefined();
    expect(day?.startDate).toBe(picked);
    expect(day?.endDate).toBe(picked);
    expect(day?.isCompleted).toBe(true);

    expect(year?.datePrecision).toBe("year");
    expect(year?.endDate).toBe(Date.UTC(2023, 6, 1, 12));
    expect(year?.startDate).toBe(year?.endDate);
    expect(year?.completionTimeMinutes).toBeUndefined();

    expect(unknown?.datePrecision).toBe("unknown");
    expect(unknown?.isCompleted).toBe(true);
    expect(unknown?.startDate).toBe(unknown?.endDate);
    expect(unknown?.endDate).toBeGreaterThanOrEqual(before);
    expect(unknown?.completionTimeMinutes).toBeUndefined();

    for (const row of [day, year, unknown]) {
      expect(row?.userId).toBe(alice);
      expect(row?.copySnapshot?.wasBorrowed).toBe(false);
      expect(row?.puzzleId).toBeDefined();
    }
  });

  test("is all or nothing: one foreign copy writes nothing", async () => {
    const t = convexTest(schema, modules);
    const { alice, a1, c1 } = await seed(t);
    await expect(
      recordPast(t, "alice", [
        { copyId: a1.copyAggregateId, datePrecision: "unknown" },
        { copyId: c1.copyAggregateId, datePrecision: "unknown" },
      ]),
    ).rejects.toThrow(/owner, current holder or a household member/);
    expect(await rowsOf(t, alice)).toHaveLength(0);
  });

  test("is all or nothing: one invalid date writes nothing", async () => {
    const t = convexTest(schema, modules);
    const { alice, a1, a2 } = await seed(t);
    await expectConvexCode(
      recordPast(t, "alice", [
        { copyId: a1.copyAggregateId, datePrecision: "unknown" },
        { copyId: a2.copyAggregateId, datePrecision: "year", year: 1850 },
      ]),
      "InvalidYear",
    );
    expect(await rowsOf(t, alice)).toHaveLength(0);
  });

  test("requires the date fields that match each precision", async () => {
    const t = convexTest(schema, modules);
    const { a1 } = await seed(t);
    const id = a1.copyAggregateId;
    await expectConvexCode(
      recordPast(t, "alice", [{ copyId: id, datePrecision: "day" }]),
      "InvalidDatePrecision",
    );
    await expectConvexCode(
      recordPast(t, "alice", [{ copyId: id, datePrecision: "year" }]),
      "InvalidDatePrecision",
    );
    await expectConvexCode(
      recordPast(t, "alice", [
        { copyId: id, datePrecision: "unknown", date: Date.now() },
      ]),
      "InvalidDatePrecision",
    );
  });

  test("caps the batch at 25, refuses an empty batch and duplicate copies", async () => {
    const t = convexTest(schema, modules);
    const { a1 } = await seed(t);
    const item = {
      copyId: a1.copyAggregateId,
      datePrecision: "unknown" as const,
    };
    await expectConvexCode(recordPast(t, "alice", []), "InvalidBatchSize");
    await expectConvexCode(
      recordPast(
        t,
        "alice",
        Array.from({ length: 26 }, (_, i) => ({ ...item, copyId: `c-${i}` })),
      ),
      "InvalidBatchSize",
    );
    await expectConvexCode(
      recordPast(t, "alice", [item, item]),
      "DuplicateCopy",
    );
  });

  test("follows recordCompletion's copy gate: a borrower and a household member may log", async () => {
    const t = convexTest(schema, modules);
    const { alice, bob, carol, c1, a1 } = await seed(t);
    // Carol lends her copy to Bob.
    await t.run((ctx) => ctx.db.patch(c1.copyId, { heldBy: bob }));
    await recordPast(t, "bob", [
      { copyId: c1.copyAggregateId, datePrecision: "unknown" },
    ]);
    // Alice and Carol share a household, so Carol may log Alice's copy.
    await t.run(async (ctx) => {
      const householdId = crypto.randomUUID();
      await ctx.db.insert("households", {
        aggregateId: householdId,
        createdAt: Date.now(),
        defaultCopyPermission: "view",
      });
      for (const memberId of [alice, carol]) {
        await ctx.db.insert("householdMembers", {
          householdId,
          memberId,
          role: memberId === alice ? "admin" : "member",
          joinedAt: Date.now(),
        });
      }
    });
    await recordPast(t, "carol", [
      { copyId: a1.copyAggregateId, datePrecision: "year", year: 2024 },
    ]);
    expect(await rowsOf(t, bob)).toHaveLength(1);
    const [carolRow] = await rowsOf(t, carol);
    expect(carolRow?.copySnapshot?.wasBorrowed).toBe(true);
  });
});

describe("solving.recordCompletion with a date precision", () => {
  test("records year and unknown solves and refuses dates or a time on them", async () => {
    const t = convexTest(schema, modules);
    const { a1 } = await seed(t);
    const record = (args: Record<string, unknown>) =>
      as(t, "alice").mutation(api.solving.recordCompletion.recordCompletion, {
        copyId: a1.copyAggregateId,
        ...args,
      });
    const year = await record({ datePrecision: "year", year: 2022 });
    expect((await rowByAggregate(t, year.completionId))?.datePrecision).toBe(
      "year",
    );
    const unknown = await record({ datePrecision: "unknown" });
    expect((await rowByAggregate(t, unknown.completionId))?.datePrecision).toBe(
      "unknown",
    );
    await expectConvexCode(
      record({ datePrecision: "year", year: 2022, endDate: Date.now() }),
      "InvalidDatePrecision",
    );
    await expectConvexCode(
      record({ datePrecision: "unknown", completionTimeMinutes: 30 }),
      "DurationNotAllowed",
    );
    // A dated solve still needs its start.
    await expectConvexCode(record({}), "InvalidDatePrecision");
  });

  test("editing a real date onto an undated solve upgrades it to day", async () => {
    const t = convexTest(schema, modules);
    const { a1 } = await seed(t);
    const { completionId } = await as(t, "alice").mutation(
      api.solving.recordCompletion.recordCompletion,
      { copyId: a1.copyAggregateId, datePrecision: "unknown" },
    );
    // Notes alone keep it undated.
    await as(t, "alice").mutation(api.solving.editCompletion.editCompletion, {
      completionId,
      notes: "lovely",
    });
    expect((await rowByAggregate(t, completionId))?.datePrecision).toBe(
      "unknown",
    );
    const picked = Date.now() - 3 * DAY;
    await as(t, "alice").mutation(api.solving.editCompletion.editCompletion, {
      completionId,
      startDate: picked,
    });
    const row = await rowByAggregate(t, completionId);
    expect(row?.datePrecision).toBeUndefined();
    expect(row?.startDate).toBe(picked);
    expect(row?.endDate).toBe(picked);
  });
});

describe("the in-progress invariant", () => {
  test("past solves are never in progress; a running solve on the same copy stays finishable", async () => {
    const t = convexTest(schema, modules);
    const { a1 } = await seed(t);
    const running = await as(t, "alice").mutation(
      api.solving.startCompletion.startCompletion,
      { copyId: a1.copyAggregateId, startDate: Date.now() - DAY },
    );
    await recordPast(t, "alice", [
      { copyId: a1.copyAggregateId, datePrecision: "unknown" },
    ]);
    const inProgress = await as(t, "alice").query(
      api.solving.listMyInProgress.listMyInProgress,
      {},
    );
    expect(inProgress.map((s) => s.completionId)).toEqual([running]);

    await as(t, "alice").mutation(
      api.solving.finishCompletion.finishCompletion,
      { completionId: running, endDate: Date.now() },
    );
    const finished = await rowByAggregate(t, running);
    expect(finished?.isCompleted).toBe(true);
    expect(finished?.datePrecision).toBeUndefined();
    expect(
      await as(t, "alice").query(
        api.solving.listMyInProgress.listMyInProgress,
        {},
      ),
    ).toEqual([]);
  });
});

describe("the activity feed", () => {
  test("hides year, unknown and bulk solves but shows a single dated solve", async () => {
    const t = convexTest(schema, modules);
    const { alice, bob, a1, a2, a3 } = await seed(t);
    await follow(t, bob, alice);
    await recordPast(t, "alice", [
      { copyId: a1.copyAggregateId, datePrecision: "day", date: Date.now() },
      { copyId: a2.copyAggregateId, datePrecision: "year", year: 2023 },
    ]);
    await as(t, "alice").mutation(
      api.solving.recordCompletion.recordCompletion,
      { copyId: a3.copyAggregateId, datePrecision: "unknown" },
    );
    await as(t, "alice").mutation(
      api.solving.recordCompletion.recordCompletion,
      { copyId: a3.copyAggregateId, datePrecision: "year", year: 2020 },
    );
    const before = await as(t, "bob").query(
      api.social.getActivityFeed.getActivityFeed,
      {},
    );
    expect(before.filter((e) => e.kind === "completion")).toEqual([]);

    const dated = await as(t, "alice").mutation(
      api.solving.recordCompletion.recordCompletion,
      {
        copyId: a3.copyAggregateId,
        startDate: Date.now() - DAY,
        endDate: Date.now(),
      },
    );
    const after = await as(t, "bob").query(
      api.social.getActivityFeed.getActivityFeed,
      {},
    );
    expect(
      after.filter((e) => e.kind === "completion").map((e) => e.ref),
    ).toEqual([dated.completionId]);
  });
});

describe("the activity feed and past-solves batches", () => {
  // Unlike a batch of copy adds (one grouped "added N puzzles" entry), a past-solves batch is
  // hidden entirely: every solve in it is a backfill, even the ones with a picked day.
  test("a batch of dated past solves is hidden, never grouped, for followers and the member", async () => {
    const t = convexTest(schema, modules);
    const { alice, bob, a1, a2, a3 } = await seed(t);
    await follow(t, bob, alice);
    const { completionIds } = await recordPast(t, "alice", [
      { copyId: a1.copyAggregateId, datePrecision: "day", date: Date.now() },
      { copyId: a2.copyAggregateId, datePrecision: "day", date: Date.now() },
      { copyId: a3.copyAggregateId, datePrecision: "day", date: Date.now() },
    ]);
    expect(completionIds).toHaveLength(3);

    for (const viewer of ["bob", "alice"]) {
      const feed = await as(t, viewer).query(
        api.social.getActivityFeed.getActivityFeed,
        {},
      );
      expect(feed.filter((e) => e.kind === "completion")).toEqual([]);
      expect(feed.filter((e) => e.batch !== undefined)).toEqual([]);
      expect(feed.some((e) => completionIds.includes(e.ref))).toBe(false);
    }
  });
});

describe("goals", () => {
  test("count dated and year-only solves, never undated ones", async () => {
    const t = convexTest(schema, modules);
    const { a1, a2, a3 } = await seed(t);
    const goalId = (await as(t, "alice").mutation(
      api.solving.createGoal.createGoal,
      { title: "Solve 5", targetCompletions: 5 },
    )) as string;
    await recordPast(t, "alice", [
      { copyId: a1.copyAggregateId, datePrecision: "day", date: Date.now() },
      { copyId: a2.copyAggregateId, datePrecision: "year", year: 2023 },
      { copyId: a3.copyAggregateId, datePrecision: "unknown" },
    ]);
    const goal = await t.run((ctx) =>
      ctx.db
        .query("goals")
        .withIndex("by_aggregate_id", (q) => q.eq("aggregateId", goalId))
        .unique(),
    );
    expect(goal?.currentCompletions).toBe(2);
  });
});

describe("insights", () => {
  // A legacy row: no aggregateId and no datePrecision, so it must read as "day".
  const insertLegacy = (t: T, userId: Id<"users">, endDate: number) =>
    t.run(async (ctx) => {
      await ctx.db.insert("completions", {
        userId,
        startDate: endDate - 2 * 60 * 60 * 1000,
        endDate,
        completionTimeMinutes: 120,
        photos: [],
        isCompleted: true,
        createdAt: endDate,
        updatedAt: endDate,
      });
    });

  test("the monthly trend counts only dated solves (absent = day)", async () => {
    const t = convexTest(schema, modules);
    const { alice, a1, a2 } = await seed(t);
    await insertLegacy(t, alice, Date.now());
    await recordPast(t, "alice", [
      {
        copyId: a1.copyAggregateId,
        datePrecision: "year",
        year: new Date().getUTCFullYear(),
      },
      { copyId: a2.copyAggregateId, datePrecision: "unknown" },
    ]);
    const trends = await as(t, "alice").query(
      api.insights.getCompletionTrends.getCompletionTrends,
      {},
    );
    expect(trends.reduce((sum, p) => sum + p.count, 0)).toBe(1);
    expect(trends.reduce((sum, p) => sum + p.totalMinutes, 0)).toBe(120);
  });

  test("lifetime totals count every precision; time averages only dated solves", async () => {
    const t = convexTest(schema, modules);
    const { alice, a1, a2 } = await seed(t);
    await insertLegacy(t, alice, Date.now());
    await recordPast(t, "alice", [
      { copyId: a1.copyAggregateId, datePrecision: "year", year: 2023 },
      { copyId: a2.copyAggregateId, datePrecision: "unknown" },
    ]);
    const stats = await as(t, "alice").query(
      api.insights.getPersonalStats.getPersonalStats,
      {},
    );
    expect(stats.completionsCount).toBe(3);
    expect(stats.totalSolveMinutes).toBe(120);
    expect(stats.averageSolveMinutes).toBe(120);
  });
});

describe("profile completions", () => {
  test("carry the precision and list undated solves last, across pages", async () => {
    const t = convexTest(schema, modules);
    const { alice, a1, a2, a3 } = await seed(t);
    const extra = await insertCopy(t, alice, "Forest");
    // Undated first, so creation order alone would NOT put it last.
    await recordPast(t, "alice", [
      { copyId: a1.copyAggregateId, datePrecision: "unknown" },
    ]);
    await recordPast(t, "alice", [
      { copyId: a2.copyAggregateId, datePrecision: "year", year: 2023 },
    ]);
    await recordPast(t, "alice", [
      {
        copyId: a3.copyAggregateId,
        datePrecision: "day",
        date: Date.now() - DAY,
      },
    ]);
    await recordPast(t, "alice", [
      { copyId: extra.copyAggregateId, datePrecision: "unknown" },
    ]);

    // Every page size walks the same order, including pages that end on the phase boundary.
    for (const numItems of [1, 2, 3, 10]) {
      const seen: { title?: string; datePrecision: string }[] = [];
      let cursor: string | null = null;
      for (let guard = 0; guard < 20; guard++) {
        const result: {
          page: { title?: string; datePrecision: string }[];
          isDone: boolean;
          continueCursor: string;
        } = await as(t, "alice").query(
          api.social.listProfileCompletions.listProfileCompletions,
          { memberId: alice, paginationOpts: { numItems, cursor } },
        );
        seen.push(...result.page);
        if (result.isDone) break;
        cursor = result.continueCursor;
      }
      expect(seen.map((r) => [r.title, r.datePrecision])).toEqual([
        ["Harbour", "day"],
        ["Cats", "year"],
        ["Forest", "unknown"],
        ["Mountain Lake", "unknown"],
      ]);
    }
  });
});
