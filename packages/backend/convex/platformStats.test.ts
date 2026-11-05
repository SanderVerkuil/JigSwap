import { convexTest, type TestConvex } from "convex-test";
import { getFunctionName } from "convex/server";
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import { api, internal } from "./_generated/api";
import type { Doc, Id } from "./_generated/dataModel";
import crons from "./crons";
import schema from "./schema";

// Landing stats (PERF-B2m, frontend B3): the public home page reads one recounted platformStats
// row instead of collecting users, puzzles and ownedPuzzles. The counts keep their legacy meaning
// (every row of each table, whatever its state) and are refreshed by insights/platformStats.recount
// on a cron; until the first recount has written the row, getGlobalStats counts the tables.

const modules = import.meta.glob(["./**/*.{js,ts}", "!./**/*.test.{js,ts}"]);

type T = TestConvex<typeof schema>;
const BASE = 1_700_000_000_000;

const recount = internal.insights.platformStats.recount;
const getGlobalStats = api.insights.getGlobalStats.getGlobalStats;

beforeEach(() => {
  vi.spyOn(console, "log").mockImplementation(() => {});
});
afterEach(() => {
  vi.restoreAllMocks();
});

type Seed = {
  activeUsers?: number;
  inactiveUsers?: number;
  puzzleStatuses?: Doc<"puzzles">["status"][];
  copies?: number;
  bio?: string;
};

// Members (active and deactivated), definitions in the given statuses and copies of the first one.
const seed = (t: T, spec: Seed) =>
  t.run(async (ctx) => {
    const userIds: Id<"users">[] = [];
    const users = [
      ...Array.from({ length: spec.activeUsers ?? 0 }, () => true),
      ...Array.from({ length: spec.inactiveUsers ?? 0 }, () => false),
    ];
    for (const [i, isActive] of users.entries()) {
      userIds.push(
        await ctx.db.insert("users", {
          clerkId: `clerk_${crypto.randomUUID()}`,
          name: `member ${i}`,
          isActive,
          ...(spec.bio !== undefined && { bio: spec.bio }),
          createdAt: BASE + i,
          updatedAt: BASE + i,
        }),
      );
    }
    const puzzleIds: Id<"puzzles">[] = [];
    for (const [i, status] of (spec.puzzleStatuses ?? []).entries()) {
      puzzleIds.push(
        await ctx.db.insert("puzzles", {
          title: `Puzzle ${i}`,
          pieceCount: 1000,
          status,
          submittedBy: userIds[0],
          createdAt: BASE + i,
          updatedAt: BASE + i,
        }),
      );
    }
    for (let i = 0; i < (spec.copies ?? 0); i++) {
      await ctx.db.insert("ownedPuzzles", {
        puzzleId: puzzleIds[0],
        ownerId: userIds[i % userIds.length],
        condition: "good",
        availability: { forTrade: false, forSale: false, forLend: false },
        createdAt: BASE + i,
        updatedAt: BASE + i,
      });
    }
  });

// Run the first batch, then drain the batches it schedules.
const runRecount = async (t: T, args: { batchSize?: number } = {}) => {
  vi.useFakeTimers();
  try {
    await t.mutation(recount, args);
    await t.finishAllScheduledFunctions(vi.runAllTimers);
  } finally {
    vi.useRealTimers();
  }
};

const statsRows = (t: T) =>
  t.run((ctx) => ctx.db.query("platformStats").collect());

const MIXED: Seed = {
  activeUsers: 3,
  inactiveUsers: 2,
  puzzleStatuses: ["approved", "pending", "rejected", "disabled", "approved"],
  copies: 7,
};
const MIXED_STATS = { totalUsers: 5, totalPuzzles: 5, totalOwnedPuzzles: 7 };

describe("insights.getGlobalStats before the first recount", () => {
  test("counts every row of the three tables (legacy fallback)", async () => {
    const t = convexTest(schema, modules);
    await seed(t, MIXED);
    expect(await statsRows(t)).toEqual([]);
    expect(await t.query(getGlobalStats, {})).toEqual(MIXED_STATS);
  });
});

describe("insights.platformStats.recount", () => {
  test("stores the legacy counts: deactivated members and definitions in any status count", async () => {
    const t = convexTest(schema, modules);
    await seed(t, MIXED);
    await runRecount(t);

    const rows = await statsRows(t);
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      key: "global",
      users: 5,
      puzzles: 5,
      ownedPuzzles: 7,
    });
    expect(await t.query(getGlobalStats, {})).toEqual(MIXED_STATS);
  });

  test("getGlobalStats serves the recounted row until the next recount refreshes it", async () => {
    const t = convexTest(schema, modules);
    await seed(t, MIXED);
    await runRecount(t);

    // Rows added after the recount are not visible until the next one.
    await seed(t, { activeUsers: 2, puzzleStatuses: ["pending"], copies: 1 });
    expect(await t.query(getGlobalStats, {})).toEqual(MIXED_STATS);

    await runRecount(t);
    expect(await t.query(getGlobalStats, {})).toEqual({
      totalUsers: 7,
      totalPuzzles: 6,
      totalOwnedPuzzles: 8,
    });
    expect(await statsRows(t)).toHaveLength(1);
  });

  test("walks every table in small batches, exactly and idempotently", async () => {
    const t = convexTest(schema, modules);
    await seed(t, {
      activeUsers: 4,
      inactiveUsers: 1,
      puzzleStatuses: ["approved", "pending", "approved"],
      copies: 9,
    });
    const expected = { totalUsers: 5, totalPuzzles: 3, totalOwnedPuzzles: 9 };

    await runRecount(t, { batchSize: 2 });
    expect(await t.query(getGlobalStats, {})).toEqual(expected);
    await runRecount(t, { batchSize: 2 });
    expect(await t.query(getGlobalStats, {})).toEqual(expected);
    expect(await statsRows(t)).toHaveLength(1);
  });

  test("empty tables give a zero row", async () => {
    const t = convexTest(schema, modules);
    await runRecount(t);
    expect(await statsRows(t)).toHaveLength(1);
    expect(await t.query(getGlobalStats, {})).toEqual({
      totalUsers: 0,
      totalPuzzles: 0,
      totalOwnedPuzzles: 0,
    });
  });
});

describe("landing stats read a bounded number of documents", () => {
  const DOCUMENTS_READ = 5;

  test(`with 300 copies, the recount batches and getGlobalStats each stay under ${DOCUMENTS_READ} reads`, async () => {
    const t = convexTest({
      schema,
      modules,
      transactionLimits: { documentsRead: DOCUMENTS_READ },
    });
    await seed(t, {
      activeUsers: 12,
      puzzleStatuses: ["approved", "approved", "pending"],
      copies: 300,
    });

    // Each batch reads at most batchSize rows plus the stats row.
    await runRecount(t, { batchSize: DOCUMENTS_READ - 1 });
    expect(await t.query(getGlobalStats, {})).toEqual({
      totalUsers: 12,
      totalPuzzles: 3,
      totalOwnedPuzzles: 300,
    });
  });

  test("oversized rows end a batch at its byte budget instead of failing the recount", async () => {
    // Convex's per-transaction read limit (16 MiB here) would fail a batch of 20 rows near the 1 MiB
    // document cap; the recount must still finish.
    const t = convexTest({ schema, modules, transactionLimits: true });
    const bio = "x".repeat(900_000);
    // One member per transaction: seeding them together would pass the write limit.
    for (let i = 0; i < 20; i++) await seed(t, { activeUsers: 1, bio });
    await runRecount(t);
    expect(await t.query(getGlobalStats, {})).toEqual({
      totalUsers: 20,
      totalPuzzles: 0,
      totalOwnedPuzzles: 0,
    });
  });
});

describe("crons", () => {
  test("recount platform stats every 6 hours", () => {
    expect(crons.crons["recount platform stats"]).toEqual({
      name: getFunctionName(recount),
      args: [{}],
      schedule: { type: "interval", hours: 6 },
    });
  });
});
