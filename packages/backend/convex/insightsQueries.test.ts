import { convexTest } from "convex-test";
import { ConvexError } from "convex/values";
import { describe, expect, test } from "vitest";
import { api } from "./_generated/api";
import schema from "./schema";

// Bundle every Convex module for the in-memory runtime, excluding test files.
const modules = import.meta.glob(["./**/*.{js,ts}", "!./**/*.test.{js,ts}"]);

// Seed Alice with two finished completions of two copies (distinct definitions), a collection, an
// active goal, a completed exchange and a received review — enough to exercise every projection.
const seed = async (t: ReturnType<typeof convexTest>) =>
  t.run(async (ctx) => {
    const now = Date.now();
    const HOUR = 60 * 60 * 1000;

    const alice = await ctx.db.insert("users", {
      clerkId: "clerk_alice",
      email: "alice@example.com",
      name: "Alice",
      isActive: true,
      createdAt: now,
      updatedAt: now,
    });
    const bob = await ctx.db.insert("users", {
      clerkId: "clerk_bob",
      email: "bob@example.com",
      name: "Bob",
      isActive: true,
      createdAt: now,
      updatedAt: now,
    });

    const puzzleA = await ctx.db.insert("puzzles", {
      title: "Mountain Vista",
      brand: "Ravensburger",
      pieceCount: 1000,
      difficulty: "hard",
      status: "approved",
      submittedBy: alice,
      createdAt: now,
      updatedAt: now,
    });
    const puzzleB = await ctx.db.insert("puzzles", {
      title: "Ocean Calm",
      brand: "Clementoni",
      pieceCount: 500,
      difficulty: "medium",
      status: "approved",
      submittedBy: alice,
      createdAt: now,
      updatedAt: now,
    });

    const copyA = await ctx.db.insert("ownedPuzzles", {
      puzzleId: puzzleA,
      puzzleDefinitionId: "def-a",
      ownerId: alice,
      condition: "good",
      availability: { forTrade: true, forSale: false, forLend: false },
      createdAt: now,
      updatedAt: now,
    });
    await ctx.db.insert("ownedPuzzles", {
      puzzleId: puzzleB,
      puzzleDefinitionId: "def-b",
      ownerId: alice,
      condition: "like_new",
      availability: { forTrade: false, forSale: false, forLend: false },
      createdAt: now,
      updatedAt: now,
    });

    await ctx.db.insert("completions", {
      userId: alice,
      puzzleId: puzzleA,
      startDate: now - 2 * HOUR,
      endDate: now - HOUR,
      completionTimeMinutes: 60,
      rating: 4,
      photos: [],
      isCompleted: true,
      createdAt: now,
      updatedAt: now,
    });
    await ctx.db.insert("completions", {
      userId: alice,
      puzzleId: puzzleB,
      startDate: now - 3 * HOUR,
      endDate: now - HOUR,
      completionTimeMinutes: 120,
      rating: 2,
      photos: [],
      isCompleted: true,
      createdAt: now,
      updatedAt: now,
    });
    // In-progress completion: must be excluded from totals.
    await ctx.db.insert("completions", {
      userId: alice,
      puzzleId: puzzleA,
      startDate: now,
      photos: [],
      isCompleted: false,
      createdAt: now,
      updatedAt: now,
    });

    await ctx.db.insert("collections", {
      userId: alice,
      name: "Favorites",
      visibility: "private",
      isDefault: true,
      createdAt: now,
      updatedAt: now,
    });

    await ctx.db.insert("goals", {
      userId: alice,
      title: "Solve 10",
      targetCompletions: 10,
      currentCompletions: 2,
      isActive: true,
      createdAt: now,
      updatedAt: now,
    });

    const exchange = await ctx.db.insert("exchanges", {
      initiatorId: alice,
      recipientId: bob,
      type: "trade",
      requestedPuzzleId: copyA,
      status: "completed",
      createdAt: now,
      updatedAt: now,
    });
    await ctx.db.insert("reviews", {
      exchangeId: exchange,
      reviewerId: bob,
      revieweeId: alice,
      rating: 5,
      categories: {
        communication: 5,
        packaging: 5,
        condition: 5,
        timeliness: 5,
      },
      createdAt: now,
    });

    return { alice, bob };
  });

const asAlice = (t: ReturnType<typeof convexTest>) =>
  t.withIdentity({ subject: "clerk_alice" });

describe("insights.getPersonalStats", () => {
  test("requires authentication", async () => {
    const t = convexTest(schema, modules);
    await seed(t);
    await expect(
      t.query(api.insights.getPersonalStats.getPersonalStats, {}),
    ).rejects.toBeInstanceOf(ConvexError);
  });

  test("rolls the member's rows into the stats card", async () => {
    const t = convexTest(schema, modules);
    await seed(t);
    const stats = await asAlice(t).query(
      api.insights.getPersonalStats.getPersonalStats,
      {},
    );
    expect(stats.completionsCount).toBe(2); // in-progress excluded
    expect(stats.totalSolveMinutes).toBe(180);
    expect(stats.averageSolveMinutes).toBe(90);
    expect(stats.puzzlesOwned).toBe(2);
    expect(stats.distinctDefinitions).toBe(2);
    expect(stats.collectionsCount).toBe(1);
    expect(stats.exchangesCompleted).toBe(1);
    expect(stats.averageRatingGiven).toBe(3); // (4+2)/2
    expect(stats.averageRatingReceived).toBe(5);
    expect(stats.goalsActive).toBe(1);
    expect(stats.goalsAchieved).toBe(0);
  });
});

describe("insights.getCollectionBreakdown", () => {
  test("returns distribution arrays over owned copies", async () => {
    const t = convexTest(schema, modules);
    await seed(t);
    const breakdown = await asAlice(t).query(
      api.insights.getCollectionBreakdown.getCollectionBreakdown,
      {},
    );
    expect(breakdown.byPieceCount).toEqual([
      { label: "500-999", value: 1 },
      { label: "1000-1999", value: 1 },
    ]);
    expect(breakdown.byBrand).toEqual(
      expect.arrayContaining([
        { label: "Ravensburger", value: 1 },
        { label: "Clementoni", value: 1 },
      ]),
    );
    expect(breakdown.byCondition).toEqual(
      expect.arrayContaining([
        { label: "good", value: 1 },
        { label: "like_new", value: 1 },
      ]),
    );
  });
});

describe("insights.getCompletionTrends / getTradeActivity", () => {
  test("trends bucket the member's finished completions", async () => {
    const t = convexTest(schema, modules);
    await seed(t);
    const trends = await asAlice(t).query(
      api.insights.getCompletionTrends.getCompletionTrends,
      {},
    );
    expect(trends).toHaveLength(12);
    expect(trends.reduce((acc, p) => acc + p.count, 0)).toBe(2);
  });

  test("trade activity counts the completed exchange", async () => {
    const t = convexTest(schema, modules);
    await seed(t);
    const activity = await asAlice(t).query(
      api.insights.getTradeActivity.getTradeActivity,
      {},
    );
    expect(activity.total).toBe(1);
    expect(activity.byStatus.find((s) => s.status === "completed")?.count).toBe(
      1,
    );
    expect(activity.byMonth).toHaveLength(1);
  });
});

describe("insights.exportUserData", () => {
  test("bundles the member's own data with resolved puzzle titles", async () => {
    const t = convexTest(schema, modules);
    await seed(t);
    const data = await asAlice(t).query(
      api.insights.exportUserData.exportUserData,
      {},
    );
    expect(data.user?.email).toBe("alice@example.com");
    expect(data.completions).toHaveLength(3);
    expect(data.ownedPuzzles).toHaveLength(2);
    expect(data.collections).toHaveLength(1);
    expect(data.goals).toHaveLength(1);
    expect(data.exchanges).toHaveLength(1);
    expect(data.limitPerCollection).toBeGreaterThan(0);
    expect(data.ownedPuzzles.map((c) => c.puzzleTitle).sort()).toEqual([
      "Mountain Vista",
      "Ocean Calm",
    ]);
  });
});
