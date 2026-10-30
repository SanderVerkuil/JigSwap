import { convexTest, type TestConvex } from "convex-test";
import { describe, expect, test } from "vitest";
import { api } from "./_generated/api";
import type { Id } from "./_generated/dataModel";
import { INSIGHTS_READ_CAP } from "./insights/getPersonalStats";
import schema from "./schema";

// Bundle every Convex module for the in-memory runtime, excluding test files.
const modules = import.meta.glob(["./**/*.{js,ts}", "!./**/*.test.{js,ts}"]);

const DAY = 24 * 60 * 60 * 1000;

const seedMember = (t: TestConvex<typeof schema>) =>
  t.run(async (ctx) => {
    const now = Date.now();
    const mkUser = (clerkId: string) =>
      ctx.db.insert("users", {
        clerkId,
        email: `${clerkId}@example.com`,
        name: clerkId,
        isActive: true,
        createdAt: now,
        updatedAt: now,
      });
    const me = await mkUser("clerk_me");
    const partner = await mkUser("clerk_partner");
    const puzzle = await ctx.db.insert("puzzles", {
      title: "Lighthouse",
      brand: "Ravensburger",
      pieceCount: 1000,
      status: "approved",
      submittedBy: me,
      createdAt: now,
      updatedAt: now,
    });
    return { me, partner, puzzle };
  });

type Seeded = Awaited<ReturnType<typeof seedMember>>;

// Finished solves, inserted in the order given (so the first is the oldest-created row).
const insertSolves = (
  t: TestConvex<typeof schema>,
  s: Seeded,
  endDates: number[],
) =>
  t.run(async (ctx) => {
    for (const endDate of endDates) {
      await ctx.db.insert("completions", {
        userId: s.me,
        puzzleId: s.puzzle,
        startDate: endDate - 60 * 60 * 1000,
        endDate,
        completionTimeMinutes: 60,
        photos: [],
        isCompleted: true,
        createdAt: endDate,
        updatedAt: endDate,
      });
    }
  });

const insertCopies = (
  t: TestConvex<typeof schema>,
  s: Seeded,
  count: number,
  ownerId: Id<"users"> = s.me,
) =>
  t.run(async (ctx) => {
    const now = Date.now();
    for (let i = 0; i < count; i++) {
      await ctx.db.insert("ownedPuzzles", {
        puzzleId: s.puzzle,
        ownerId,
        condition: "good",
        availability: { forTrade: false, forSale: false, forLend: false },
        createdAt: now,
        updatedAt: now,
      });
    }
  });

const asMe = (t: TestConvex<typeof schema>) =>
  t.withIdentity({ subject: "clerk_me" });

const monthKey = (epochMs: number) => {
  const d = new Date(epochMs);
  return `${d.getUTCFullYear()}-${`${d.getUTCMonth() + 1}`.padStart(2, "0")}`;
};

describe("insights reads are bounded at INSIGHTS_READ_CAP (PERF-B13)", () => {
  test("getPersonalStats counts at most INSIGHTS_READ_CAP rows per table", async () => {
    const t = convexTest(schema, modules);
    const s = await seedMember(t);
    const now = Date.now();
    await insertSolves(
      t,
      s,
      Array.from({ length: INSIGHTS_READ_CAP + 1 }, () => now),
    );
    await insertCopies(t, s, INSIGHTS_READ_CAP + 1);

    const stats = await asMe(t).query(
      api.insights.getPersonalStats.getPersonalStats,
      {},
    );

    expect(stats.completionsCount).toBe(INSIGHTS_READ_CAP);
    expect(stats.puzzlesOwned).toBe(INSIGHTS_READ_CAP);
  });

  test("getCompletionTrends keeps the newest solves past the cap", async () => {
    const t = convexTest(schema, modules);
    const s = await seedMember(t);
    const now = Date.now();
    const earlier = now - 90 * DAY;
    // The oldest-created solve sits in an earlier month inside the 12-month window; only it falls
    // past the cap, so its month must stay empty.
    await insertSolves(t, s, [
      earlier,
      ...Array.from({ length: INSIGHTS_READ_CAP }, () => now),
    ]);

    const trend = await asMe(t).query(
      api.insights.getCompletionTrends.getCompletionTrends,
      {},
    );

    const countOf = (month: string) =>
      trend.find((p) => p.month === month)?.count;
    expect(countOf(monthKey(now))).toBe(INSIGHTS_READ_CAP);
    expect(countOf(monthKey(earlier))).toBe(0);
  });

  test("getCollectionBreakdown spreads at most INSIGHTS_READ_CAP copies", async () => {
    const t = convexTest(schema, modules);
    const s = await seedMember(t);
    await insertCopies(t, s, INSIGHTS_READ_CAP + 1);

    const breakdown = await asMe(t).query(
      api.insights.getCollectionBreakdown.getCollectionBreakdown,
      {},
    );

    const total = breakdown.byCondition.reduce((sum, e) => sum + e.value, 0);
    expect(total).toBe(INSIGHTS_READ_CAP);
  });

  test("getTradeActivity keeps the newest exchanges by createdAt past the cap", async () => {
    const t = convexTest(schema, modules);
    const s = await seedMember(t);
    await insertCopies(t, s, 1, s.partner);
    const oldMonth = Date.UTC(2020, 0, 15);
    const now = Date.now();
    await t.run(async (ctx) => {
      const [partnersCopy] = await ctx.db
        .query("ownedPuzzles")
        .withIndex("by_owner", (q) => q.eq("ownerId", s.partner))
        .take(1);
      // The oldest exchange by createdAt is inserted LAST, so only a createdAt-ordered read drops it.
      const createdAts = [
        ...Array.from({ length: INSIGHTS_READ_CAP }, () => now),
        oldMonth,
      ];
      for (const createdAt of createdAts) {
        await ctx.db.insert("exchanges", {
          initiatorId: s.me,
          recipientId: s.partner,
          type: "loan",
          requestedPuzzleId: partnersCopy._id,
          status: "completed",
          createdAt,
          updatedAt: createdAt,
        });
      }
    });

    const activity = await asMe(t).query(
      api.insights.getTradeActivity.getTradeActivity,
      {},
    );

    expect(activity.total).toBe(INSIGHTS_READ_CAP);
    expect(activity.byMonth.map((m) => m.month)).not.toContain(
      monthKey(oldMonth),
    );
  });
});
