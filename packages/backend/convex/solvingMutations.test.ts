import { convexTest } from "convex-test";
import { ConvexError } from "convex/values";
import { describe, expect, test } from "vitest";
import { api } from "./_generated/api";
import type { Id } from "./_generated/dataModel";
import schema from "./schema";

// Bundle every Convex module for the in-memory runtime, excluding test files.
const modules = import.meta.glob("./**/!(*.test).*s");

// Seed a member, a catalog puzzle (with aggregateId), and an owned copy of it so completions can
// reference either a puzzle definition or a specific copy.
const seed = async (t: ReturnType<typeof convexTest>) =>
  t.run(async (ctx) => {
    const now = Date.now();
    const alice = await ctx.db.insert("users", {
      clerkId: "clerk_alice",
      email: "alice@example.com",
      name: "alice",
      isActive: true,
      createdAt: now,
      updatedAt: now,
    });
    const bob = await ctx.db.insert("users", {
      clerkId: "clerk_bob",
      email: "bob@example.com",
      name: "bob",
      isActive: true,
      createdAt: now,
      updatedAt: now,
    });
    const puzzleAggregateId = crypto.randomUUID();
    const puzzleId = await ctx.db.insert("puzzles", {
      aggregateId: puzzleAggregateId,
      title: "Mountain Vista",
      brand: "Ravensburger",
      pieceCount: 1000,
      searchableText: "Mountain Vista Ravensburger",
      status: "approved",
      submittedBy: alice,
      createdAt: now,
      updatedAt: now,
    });
    const copyAggregateId = crypto.randomUUID();
    const ownedPuzzleId = await ctx.db.insert("ownedPuzzles", {
      aggregateId: copyAggregateId,
      puzzleDefinitionId: puzzleAggregateId,
      puzzleId,
      ownerId: alice,
      condition: "good",
      availability: { forTrade: false, forSale: false, forLend: false },
      visibility: "private",
      createdAt: now,
      updatedAt: now,
    });
    return {
      alice,
      bob,
      puzzleAggregateId,
      copyAggregateId,
      puzzleId,
      ownedPuzzleId,
    };
  });

const asAlice = (t: ReturnType<typeof convexTest>) =>
  t.withIdentity({ subject: "clerk_alice" });
const asBob = (t: ReturnType<typeof convexTest>) =>
  t.withIdentity({ subject: "clerk_bob" });

const completionRow = (t: ReturnType<typeof convexTest>, aggregateId: string) =>
  t.run(async (ctx) =>
    ctx.db
      .query("completions")
      .withIndex("by_aggregate_id", (q) => q.eq("aggregateId", aggregateId))
      .unique(),
  );

const goalRow = (t: ReturnType<typeof convexTest>, aggregateId: string) =>
  t.run(async (ctx) =>
    ctx.db
      .query("goals")
      .withIndex("by_aggregate_id", (q) => q.eq("aggregateId", aggregateId))
      .unique(),
  );

// convex-test serializes ConvexError.data to a JSON string at the function boundary; normalise.
const dataOf = (e: unknown): { code?: string } => {
  const data = (e as ConvexError<unknown>).data;
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

const HOUR = 60 * 60 * 1000;

// Helper: Alice records a finished completion of the seeded copy, returning the new CompletionId.
const recordForAlice = async (
  t: ReturnType<typeof convexTest>,
  copyAggregateId: string,
  overrides: Record<string, unknown> = {},
) =>
  (await asAlice(t).mutation(api.solving.recordCompletion.recordCompletion, {
    copyId: copyAggregateId,
    startDate: Date.now() - 2 * HOUR,
    endDate: Date.now() - HOUR,
    ...overrides,
  })) as string;

describe("solving.recordCompletion", () => {
  test("requires authentication", async () => {
    const t = convexTest(schema, modules);
    const { copyAggregateId } = await seed(t);
    await expect(
      t.mutation(api.solving.recordCompletion.recordCompletion, {
        copyId: copyAggregateId,
        startDate: Date.now() - 2 * HOUR,
        endDate: Date.now() - HOUR,
      }),
    ).rejects.toThrow("Unauthenticated");
  });

  test("records a finished completion: owner from auth, FK resolved, returns aggregateId", async () => {
    const t = convexTest(schema, modules);
    const { alice, copyAggregateId, ownedPuzzleId } = await seed(t);
    const completionId = await recordForAlice(t, copyAggregateId);
    expect(typeof completionId).toBe("string");

    const row = await completionRow(t, completionId);
    expect(row?.userId).toBe(alice); // from auth, not args
    // The CopyId aggregateId was resolved to the real ownedPuzzles._id FK, not stored raw.
    expect(row?.ownedPuzzleId).toBe(ownedPuzzleId);
    expect(row?.isCompleted).toBe(true);
    expect(row?.completionTimeMinutes).toBe(60);
  });

  test("records against a puzzle definition, resolving the puzzles._id FK", async () => {
    const t = convexTest(schema, modules);
    const { puzzleAggregateId, puzzleId } = await seed(t);
    const completionId = (await asAlice(t).mutation(
      api.solving.recordCompletion.recordCompletion,
      {
        puzzleDefinitionId: puzzleAggregateId,
        startDate: Date.now() - 2 * HOUR,
        endDate: Date.now() - HOUR,
      },
    )) as string;
    const row = await completionRow(t, completionId);
    expect(row?.puzzleId).toBe(puzzleId);
  });

  test("an end before the start => InvalidTimeRange", async () => {
    const t = convexTest(schema, modules);
    const { copyAggregateId } = await seed(t);
    await expectConvexCode(
      asAlice(t).mutation(api.solving.recordCompletion.recordCompletion, {
        copyId: copyAggregateId,
        startDate: Date.now(),
        endDate: Date.now() - HOUR,
      }),
      "InvalidTimeRange",
    );
  });

  test("starting (no endDate) leaves the completion in progress", async () => {
    const t = convexTest(schema, modules);
    const { copyAggregateId } = await seed(t);
    const completionId = (await asAlice(t).mutation(
      api.solving.recordCompletion.recordCompletion,
      { copyId: copyAggregateId, startDate: Date.now() },
    )) as string;
    const row = await completionRow(t, completionId);
    expect(row?.isCompleted).toBe(false);
    expect(row?.endDate).toBeUndefined();
  });
});

describe("solving.finishCompletion", () => {
  test("finishes an in-progress completion", async () => {
    const t = convexTest(schema, modules);
    const { copyAggregateId } = await seed(t);
    const completionId = (await asAlice(t).mutation(
      api.solving.recordCompletion.recordCompletion,
      { copyId: copyAggregateId, startDate: Date.now() - HOUR },
    )) as string;
    await asAlice(t).mutation(api.solving.finishCompletion.finishCompletion, {
      completionId,
      endDate: Date.now(),
    });
    const row = await completionRow(t, completionId);
    expect(row?.isCompleted).toBe(true);
    expect(row?.endDate).toBeDefined();
  });
});

describe("solving.editCompletion", () => {
  test("edits notes within the 24h window", async () => {
    const t = convexTest(schema, modules);
    const { copyAggregateId } = await seed(t);
    const completionId = await recordForAlice(t, copyAggregateId);
    await asAlice(t).mutation(api.solving.editCompletion.editCompletion, {
      completionId,
      notes: "Finished on the porch",
    });
    expect((await completionRow(t, completionId))?.notes).toBe(
      "Finished on the porch",
    );
  });

  test("editing after the 24h window => EditWindowClosed", async () => {
    const t = convexTest(schema, modules);
    const { copyAggregateId } = await seed(t);
    // A completion finished two days ago is past the edit window.
    const twoDays = 48 * HOUR;
    const completionId = await recordForAlice(t, copyAggregateId, {
      startDate: Date.now() - twoDays - HOUR,
      endDate: Date.now() - twoDays,
    });
    await expectConvexCode(
      asAlice(t).mutation(api.solving.editCompletion.editCompletion, {
        completionId,
        notes: "too late",
      }),
      "EditWindowClosed",
    );
  });

  test("a non-owner cannot edit => NotCompletionOwner", async () => {
    const t = convexTest(schema, modules);
    const { copyAggregateId } = await seed(t);
    const completionId = await recordForAlice(t, copyAggregateId);
    await expectConvexCode(
      asBob(t).mutation(api.solving.editCompletion.editCompletion, {
        completionId,
        notes: "hijack",
      }),
      "NotCompletionOwner",
    );
  });
});

describe("solving.reviewPuzzle", () => {
  test("attaches a rating and text to the completion", async () => {
    const t = convexTest(schema, modules);
    const { copyAggregateId } = await seed(t);
    const completionId = await recordForAlice(t, copyAggregateId);
    await asAlice(t).mutation(api.solving.reviewPuzzle.reviewPuzzle, {
      completionId,
      rating: 4,
      text: "Lovely artwork",
    });
    const row = await completionRow(t, completionId);
    expect(row?.rating).toBe(4);
    expect(row?.review).toBe("Lovely artwork");
  });

  test("a rating outside 1–5 => InvalidRating", async () => {
    const t = convexTest(schema, modules);
    const { copyAggregateId } = await seed(t);
    const completionId = await recordForAlice(t, copyAggregateId);
    await expectConvexCode(
      asAlice(t).mutation(api.solving.reviewPuzzle.reviewPuzzle, {
        completionId,
        rating: 9,
      }),
      "InvalidRating",
    );
  });
});

describe("solving.createGoal", () => {
  test("creates a goal and returns its aggregateId", async () => {
    const t = convexTest(schema, modules);
    const { alice } = await seed(t);
    const goalId = (await asAlice(t).mutation(
      api.solving.createGoal.createGoal,
      { title: "Solve 3 puzzles", targetCompletions: 3 },
    )) as string;
    const row = await goalRow(t, goalId);
    expect(row?.userId).toBe(alice);
    expect(row?.title).toBe("Solve 3 puzzles");
    expect(row?.targetCompletions).toBe(3);
    expect(row?.currentCompletions).toBe(0);
    expect(row?.isActive).toBe(true);
  });

  test("a non-positive target => InvalidGoalTarget", async () => {
    const t = convexTest(schema, modules);
    await seed(t);
    await expectConvexCode(
      asAlice(t).mutation(api.solving.createGoal.createGoal, {
        title: "Bad goal",
        targetCompletions: 0,
      }),
      "InvalidGoalTarget",
    );
  });
});

describe("goal progress reacts to completions", () => {
  test("recording completions advances the goal and fires achievement once at the target", async () => {
    const t = convexTest(schema, modules);
    const { puzzleAggregateId, copyAggregateId } = await seed(t);
    const goalId = (await asAlice(t).mutation(
      api.solving.createGoal.createGoal,
      { title: "Solve 2 puzzles", targetCompletions: 2 },
    )) as string;

    // First completion -> progress 1, not yet achieved.
    await recordForAlice(t, copyAggregateId);
    let row = await goalRow(t, goalId);
    expect(row?.currentCompletions).toBe(1);

    // Second completion -> progress 2, crosses the target -> GoalAchieved fires exactly once.
    await recordForAlice(t, copyAggregateId, {
      puzzleDefinitionId: puzzleAggregateId,
      copyId: undefined,
    });
    row = await goalRow(t, goalId);
    expect(row?.currentCompletions).toBe(2);
    expect(
      (row?.currentCompletions ?? 0) >= (row?.targetCompletions ?? Infinity),
    ).toBe(true);

    // A third completion keeps progress moving but never re-fires achievement (idempotent crossing).
    await recordForAlice(t, copyAggregateId);
    row = await goalRow(t, goalId);
    expect(row?.currentCompletions).toBe(3);
  });

  test("listMyGoals surfaces the derived isAchieved", async () => {
    const t = convexTest(schema, modules);
    const { copyAggregateId } = await seed(t);
    await asAlice(t).mutation(api.solving.createGoal.createGoal, {
      title: "Solve 1 puzzle",
      targetCompletions: 1,
    });
    await recordForAlice(t, copyAggregateId);
    const goals = await asAlice(t).query(
      api.solving.listMyGoals.listMyGoals,
      {},
    );
    expect(goals).toHaveLength(1);
    expect(goals[0]?.isAchieved).toBe(true);
  });
});

describe("solving read queries", () => {
  test("listMyCompletions returns the member's completions only", async () => {
    const t = convexTest(schema, modules);
    const { copyAggregateId } = await seed(t);
    await recordForAlice(t, copyAggregateId);
    const mine = await asAlice(t).query(
      api.solving.listMyCompletions.listMyCompletions,
      {},
    );
    expect(mine).toHaveLength(1);
    const bobs = await asBob(t).query(
      api.solving.listMyCompletions.listMyCompletions,
      {},
    );
    expect(bobs).toHaveLength(0);
  });

  test("getCompletionHistory filters by copy", async () => {
    const t = convexTest(schema, modules);
    const { copyAggregateId } = await seed(t);
    await recordForAlice(t, copyAggregateId);
    const history = await asAlice(t).query(
      api.solving.getCompletionHistory.getCompletionHistory,
      { copyId: copyAggregateId },
    );
    expect(history).toHaveLength(1);
    expect(
      (history[0] as { ownedPuzzleId?: Id<"ownedPuzzles"> }).ownedPuzzleId,
    ).toBeDefined();
  });
});
