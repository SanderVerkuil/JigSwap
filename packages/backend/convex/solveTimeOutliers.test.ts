import { MAX_SOLVE_MINUTES } from "@jigswap/domain";
import { convexTest, type TestConvex } from "convex-test";
import { beforeEach, describe, expect, test } from "vitest";
import { api, internal } from "./_generated/api";
import type { Id } from "./_generated/dataModel";
import { finishDaysOf } from "./library/definitionAggregates";
import schema from "./schema";

// One solve of Number.MAX_VALUE minutes used to overwrite a definition's public average solve time:
// any member can log a solve against any approved definition, and the only one who can delete it is
// the member who posted it. The bound on what is accepted (solve-duration.ts) and the reads that
// leave out what is already stored (definitionAggregates) must both hold.

const modules = import.meta.glob(["./**/*.{js,ts}", "!./**/*.test.{js,ts}"]);
const HOUR = 60;
const BASE = Date.now() - 30 * 24 * 60 * 60_000;

type T = TestConvex<typeof schema>;
let t: T;
let puzzleId: Id<"puzzles">;
let me: Id<"users">;

beforeEach(async () => {
  t = convexTest(schema, modules);
  ({ me, puzzleId } = await t.run(async (ctx) => {
    const me = await ctx.db.insert("users", {
      clerkId: "clerk_me",
      email: "me@example.com",
      name: "Me",
      isActive: true,
      createdAt: 1,
      updatedAt: 1,
    });
    const puzzleId = await ctx.db.insert("puzzles", {
      title: "Starry Night",
      pieceCount: 1000,
      status: "approved",
      submittedBy: me,
      createdAt: 1,
      updatedAt: 1,
    });
    return { me, puzzleId };
  }));
});

const asMe = () => t.withIdentity({ subject: "clerk_me" });
const publicStats = async () => {
  const view = await t.query(
    api.catalog.getPublicDefinitionView.getPublicDefinitionView,
    { puzzleId },
  );
  return view?.stats;
};
const addSolve = (minutes: number) =>
  t.run((ctx) =>
    ctx.db.insert("completions", {
      userId: me,
      puzzleId,
      startDate: Date.now(),
      endDate: Date.now(),
      completionTimeMinutes: minutes,
      photos: [],
      isCompleted: true,
      createdAt: BASE,
      updatedAt: BASE,
    }),
  );

describe("a member can't state a solve time no solve can have taken", () => {
  test.each([Number.MAX_VALUE, 1e300, MAX_SOLVE_MINUTES + 1])(
    "recordCompletion refuses %p minutes",
    async (completionTimeMinutes) => {
      await expect(
        asMe().mutation(api.solving.recordCompletion.recordCompletion, {
          puzzleDefinitionId: puzzleId,
          startDate: BASE,
          endDate: BASE + HOUR * 60_000,
          completionTimeMinutes,
        }),
      ).rejects.toThrow(/InvalidDuration/);
      expect(
        await t.run((ctx) => ctx.db.query("completions").collect()),
      ).toEqual([]);
    },
  );
});

describe("a stored solve time no solve can have taken doesn't count", () => {
  test("finishDaysOf says unknown for it, and keeps every real one", () => {
    const row = { startDate: BASE, endDate: BASE };
    for (const minutes of [Number.MAX_VALUE, Number.POSITIVE_INFINITY, -5]) {
      expect(
        finishDaysOf({ ...row, completionTimeMinutes: minutes }),
      ).toBeNull();
    }
    expect(finishDaysOf({ ...row, completionTimeMinutes: 2880 })).toBe(2);
    expect(
      finishDaysOf({ ...row, completionTimeMinutes: MAX_SOLVE_MINUTES }),
    ).toBe(3650);
    // A span too long to be a solve (no duration stored) is left out too, by its dates.
    expect(
      finishDaysOf({ startDate: Date.UTC(2001, 0, 1), endDate: BASE }),
    ).toBeNull();
  });

  test("a stored outlier leaves the public average alone", async () => {
    await addSolve(2880);
    await addSolve(Number.MAX_VALUE);

    // Read live, before the definition has a totals row.
    expect(await publicStats()).toMatchObject({
      avgCompletionDays: 2,
      totalCompletions: 2,
    });

    // And from the totals its recompute writes, weekly at the latest.
    await t.mutation(internal.library.definitionStats.recompute, { puzzleId });
    expect(await publicStats()).toMatchObject({
      avgCompletionDays: 2,
      totalCompletions: 2,
    });
  });

  test("totals stored before the bound read as unknown until their recompute", async () => {
    await addSolve(2880);
    await addSolve(Number.MAX_VALUE);
    await t.run((ctx) =>
      ctx.db.insert("definitionStats", {
        puzzleId,
        computedAt: 1,
        totals: {
          ratingCount: 0,
          ratingSum: 0,
          breakdown: [0, 0, 0, 0, 0],
          completedCount: 2,
          finishDaysSum: Number.MAX_VALUE / 1440,
          finishDaysCount: 2,
          communityOwners: 0,
          publicAvailable: { swap: 0, lend: 0, sale: 0 },
        },
      }),
    );
    expect(await publicStats()).toMatchObject({
      avgCompletionDays: null,
      totalCompletions: 2,
    });

    await t.mutation(internal.library.definitionStats.recompute, { puzzleId });
    expect(await publicStats()).toMatchObject({ avgCompletionDays: 2 });
  });

  test("the member's own numbers leave it out too", async () => {
    await addSolve(90);
    await addSolve(Number.MAX_VALUE);
    const stats = await asMe().query(
      api.insights.getPersonalStats.getPersonalStats,
      {},
    );
    expect(stats.totalSolveMinutes).toBe(90);
    expect(stats.completionsCount).toBe(2);

    await t.run(async (ctx) => {
      for (const row of await ctx.db.query("completions").collect()) {
        if (row.completionTimeMinutes !== 90) await ctx.db.delete(row._id);
      }
    });
    await addSolve(Number.MAX_VALUE);
    const trends = await asMe().query(
      api.insights.getCompletionTrends.getCompletionTrends,
      {},
    );
    expect(trends[trends.length - 1]?.totalMinutes).toBe(90);
  });

  test("a public profile's fastest solve leaves it out too", async () => {
    await t.run(async (ctx) => {
      await ctx.db.insert("profiles", {
        aggregateId: "profile_me",
        memberId: me,
        visibility: "public",
        updatedAt: 1,
      });
    });
    const fastest = async () => {
      const view = await t.query(api.social.getPublicProfile.getPublicProfile, {
        handle: me,
      });
      if (!view || view.locked) throw new Error("the profile is open");
      return view.records.fastest;
    };
    await addSolve(Number.MAX_VALUE);
    expect(await fastest()).toBeNull();
    await addSolve(90);
    expect((await fastest())?.minutes).toBe(90);
  });

  test("a copy's fastest solve leaves it out too", async () => {
    const copyId = await t.run((ctx) =>
      ctx.db.insert("ownedPuzzles", {
        puzzleId,
        ownerId: me,
        condition: "good",
        availability: { forTrade: false, forSale: false, forLend: false },
        createdAt: 1,
        updatedAt: 1,
      }),
    );
    await t.run(async (ctx) => {
      for (const minutes of [Number.MAX_VALUE, 90]) {
        await ctx.db.insert("completions", {
          userId: me,
          ownedPuzzleId: copyId,
          startDate: Date.now(),
          endDate: Date.now(),
          completionTimeMinutes: minutes,
          photos: [],
          isCompleted: true,
          createdAt: 1,
          updatedAt: 1,
        });
      }
    });
    const view = await asMe().query(
      api.library.getCopyInstanceView.getCopyInstanceView,
      { copyId },
    );
    expect(view?.stats.fastestFinishMinutes).toBe(90);
  });
});
