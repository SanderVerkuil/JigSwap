import { convexTest } from "convex-test";
import { ConvexError } from "convex/values";
import { describe, expect, test } from "vitest";
import { api } from "./_generated/api";
import type { Id } from "./_generated/dataModel";
import schema from "./schema";

// Bundle every Convex module for the in-memory runtime, excluding test files.
const modules = import.meta.glob(["./**/*.{js,ts}", "!./**/*.test.{js,ts}"]);

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
      snapshot: {
        title: "Mountain Vista",
        brand: "Ravensburger",
        pieceCount: 1000,
      },
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

// A real stored blob so fileId is a valid `_storage` id.
const storeBlob = (t: ReturnType<typeof convexTest>) =>
  t.run((ctx) => ctx.storage.store(new Blob(["img"], { type: "image/png" })));

const completionImagesFor = (
  t: ReturnType<typeof convexTest>,
  completionId: string,
) =>
  t.run(async (ctx) =>
    ctx.db
      .query("completionImages")
      .withIndex("by_completion", (q) => q.eq("completionId", completionId))
      .collect(),
  );

// Lend the seeded copy to Bob: ownership stays with Alice, possession (heldBy) moves to Bob.
const lendToBob = async (
  t: ReturnType<typeof convexTest>,
  ownedPuzzleId: Id<"ownedPuzzles">,
  bob: Id<"users">,
) =>
  t.run(async (ctx) => {
    await ctx.db.patch(ownedPuzzleId, { heldBy: bob });
  });

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

describe("solving.recordCompletion — borrowing, snapshot, pieces", () => {
  test("the current holder (borrower) can log a solve on a copy they do not own", async () => {
    const t = convexTest(schema, modules);
    const { bob, copyAggregateId, ownedPuzzleId } = await seed(t);
    await lendToBob(t, ownedPuzzleId, bob);
    const completionId = (await asBob(t).mutation(
      api.solving.recordCompletion.recordCompletion,
      {
        copyId: copyAggregateId,
        startDate: Date.now() - 2 * HOUR,
        endDate: Date.now() - HOUR,
      },
    )) as string;
    const row = await completionRow(t, completionId);
    expect(row?.userId).toBe(bob);
    expect(row?.ownedPuzzleId).toBe(ownedPuzzleId);
    expect(row?.copySnapshot?.wasBorrowed).toBe(true);
  });

  test("a non-owner who is not the holder is still rejected", async () => {
    const t = convexTest(schema, modules);
    const { copyAggregateId, ownedPuzzleId } = await seed(t);
    await expect(
      asBob(t).mutation(api.solving.recordCompletion.recordCompletion, {
        copyId: copyAggregateId,
        startDate: Date.now() - 2 * HOUR,
        endDate: Date.now() - HOUR,
      }),
    ).rejects.toBeInstanceOf(ConvexError);
    const rows = await t.run(async (ctx) =>
      ctx.db
        .query("completions")
        .withIndex("by_owned_puzzle", (q) =>
          q.eq("ownedPuzzleId", ownedPuzzleId),
        )
        .collect(),
    );
    expect(rows).toHaveLength(0);
  });

  test("an owner's completion gets a copy snapshot and a populated puzzleId anchor", async () => {
    const t = convexTest(schema, modules);
    const { copyAggregateId, puzzleId } = await seed(t);
    const completionId = await recordForAlice(t, copyAggregateId, {
      allPiecesPresent: false,
    });
    const row = await completionRow(t, completionId);
    expect(row?.puzzleId).toBe(puzzleId);
    expect(row?.allPiecesPresent).toBe(false);
    expect(row?.copySnapshot?.wasBorrowed).toBe(false);
    expect(row?.copySnapshot?.condition).toBe("good");
    expect(row?.copySnapshot?.copyId).toBe(copyAggregateId);
  });

  test("deleting the copy keeps puzzleId + snapshot; only the live link is affected", async () => {
    const t = convexTest(schema, modules);
    const { copyAggregateId, puzzleId, ownedPuzzleId } = await seed(t);
    const completionId = await recordForAlice(t, copyAggregateId);
    await t.run(async (ctx) => {
      await ctx.db.delete(ownedPuzzleId);
    });
    const row = await completionRow(t, completionId);
    expect(row?.puzzleId).toBe(puzzleId);
    expect(row?.copySnapshot?.copyId).toBe(copyAggregateId);
  });

  test("finishing a copy-only in-progress completion preserves the puzzleId anchor + snapshot", async () => {
    const t = convexTest(schema, modules);
    const { copyAggregateId, puzzleId } = await seed(t);
    // Start (no endDate, no puzzleDefinitionId): the composition root denormalizes puzzleId + snapshot.
    const completionId = (await asAlice(t).mutation(
      api.solving.recordCompletion.recordCompletion,
      { copyId: copyAggregateId, startDate: Date.now() - HOUR },
    )) as string;
    expect((await completionRow(t, completionId))?.puzzleId).toBe(puzzleId);

    // Finishing goes through the repository save() again — the anchor + snapshot must survive.
    await asAlice(t).mutation(api.solving.finishCompletion.finishCompletion, {
      completionId,
      endDate: Date.now(),
    });
    const row = await completionRow(t, completionId);
    expect(row?.isCompleted).toBe(true);
    expect(row?.puzzleId).toBe(puzzleId);
    expect(row?.copySnapshot?.copyId).toBe(copyAggregateId);
  });
});

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

  test("a non-owner cannot record a completion against someone else's copy, and nothing is written", async () => {
    const t = convexTest(schema, modules);
    const { copyAggregateId, ownedPuzzleId } = await seed(t);

    await expect(
      asBob(t).mutation(api.solving.recordCompletion.recordCompletion, {
        copyId: copyAggregateId,
        startDate: Date.now() - 2 * HOUR,
        endDate: Date.now() - HOUR,
        notes: "fabricated",
      }),
    ).rejects.toBeInstanceOf(ConvexError);

    // No completion row was inserted against the copy.
    const rows = await t.run(async (ctx) =>
      ctx.db
        .query("completions")
        .withIndex("by_owned_puzzle", (q) =>
          q.eq("ownedPuzzleId", ownedPuzzleId),
        )
        .collect(),
    );
    expect(rows).toHaveLength(0);
  });

  test("a non-owner cannot start a completion against someone else's copy, and nothing is written", async () => {
    const t = convexTest(schema, modules);
    const { copyAggregateId, ownedPuzzleId } = await seed(t);

    await expect(
      asBob(t).mutation(api.solving.recordCompletion.recordCompletion, {
        copyId: copyAggregateId,
        startDate: Date.now() - HOUR,
      }),
    ).rejects.toBeInstanceOf(ConvexError);

    const rows = await t.run(async (ctx) =>
      ctx.db
        .query("completions")
        .withIndex("by_owned_puzzle", (q) =>
          q.eq("ownedPuzzleId", ownedPuzzleId),
        )
        .collect(),
    );
    expect(rows).toHaveLength(0);

    // The owner can still log a solve for their own copy.
    const completionId = await recordForAlice(t, copyAggregateId);
    expect(typeof completionId).toBe("string");
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

  test("same-day completion (startDate == endDate, no explicit time) counts one day (1440 minutes)", async () => {
    const t = convexTest(schema, modules);
    const { copyAggregateId } = await seed(t);
    const today = Date.now();
    const completionId = (await asAlice(t).mutation(
      api.solving.recordCompletion.recordCompletion,
      { copyId: copyAggregateId, startDate: today, endDate: today },
    )) as string;
    const row = await completionRow(t, completionId);
    expect(row?.isCompleted).toBe(true);
    expect(row?.completionTimeMinutes).toBe(1440);
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

describe("solving.attachCompletionPhotos", () => {
  test("the author attaches 2 photos: photos grows, sidecars pending, jobs scheduled", async () => {
    const t = convexTest(schema, modules);
    const { copyAggregateId } = await seed(t);
    const completionId = await recordForAlice(t, copyAggregateId);
    const fileId1 = (await storeBlob(t)) as Id<"_storage">;
    const fileId2 = (await storeBlob(t)) as Id<"_storage">;

    await asAlice(t).mutation(
      api.solving.attachCompletionPhotos.attachCompletionPhotos,
      { completionId, storageIds: [fileId1, fileId2] },
    );

    const row = await completionRow(t, completionId);
    expect(row?.photos).toEqual([fileId1, fileId2]);

    const images = await completionImagesFor(t, completionId);
    expect(images).toHaveLength(2);
    for (const img of images) {
      expect(img.moderationStatus).toBe("pending");
    }

    const scheduled = await t.run((ctx) =>
      ctx.db.system.query("_scheduled_functions").collect(),
    );
    const jobs = scheduled.filter((s) =>
      s.name.includes("moderateCompletionPhoto"),
    );
    expect(jobs).toHaveLength(2);
  });

  test("a non-author is rejected", async () => {
    const t = convexTest(schema, modules);
    const { copyAggregateId } = await seed(t);
    const completionId = await recordForAlice(t, copyAggregateId);
    const fileId = (await storeBlob(t)) as Id<"_storage">;

    await expectConvexCode(
      asBob(t).mutation(
        api.solving.attachCompletionPhotos.attachCompletionPhotos,
        { completionId, storageIds: [fileId] },
      ),
      "NotCompletionOwner",
    );
  });

  test("duplicate ids within a call and an already-attached id are deduped", async () => {
    const t = convexTest(schema, modules);
    const { copyAggregateId } = await seed(t);
    const completionId = await recordForAlice(t, copyAggregateId);
    const fileId1 = (await storeBlob(t)) as Id<"_storage">;
    const fileId2 = (await storeBlob(t)) as Id<"_storage">;

    await asAlice(t).mutation(
      api.solving.attachCompletionPhotos.attachCompletionPhotos,
      { completionId, storageIds: [fileId1] },
    );
    // Re-attach fileId1 (already attached) alongside a within-call duplicate of fileId2.
    await asAlice(t).mutation(
      api.solving.attachCompletionPhotos.attachCompletionPhotos,
      { completionId, storageIds: [fileId1, fileId2, fileId2] },
    );

    const row = await completionRow(t, completionId);
    expect(row?.photos).toEqual([fileId1, fileId2]);
    const images = await completionImagesFor(t, completionId);
    expect(images).toHaveLength(2);

    // Deduped ids must not schedule extra moderation jobs: exactly 2 across BOTH calls
    // (fileId1 from the first, fileId2 from the second).
    const scheduled = await t.run((ctx) =>
      ctx.db.system.query("_scheduled_functions").collect(),
    );
    expect(
      scheduled.filter((s) => s.name.includes("moderateCompletionPhoto")),
    ).toHaveLength(2);
  });

  test("existing 4 plus 2 new exceeds the cap => TooManyPhotos", async () => {
    const t = convexTest(schema, modules);
    const { copyAggregateId } = await seed(t);
    const completionId = await recordForAlice(t, copyAggregateId);
    const existing: Id<"_storage">[] = [];
    for (let i = 0; i < 4; i++) {
      existing.push((await storeBlob(t)) as Id<"_storage">);
    }
    const seededRow = await completionRow(t, completionId);
    await t.run(async (ctx) => {
      await ctx.db.patch(seededRow!._id, { photos: existing });
    });
    const newFileId1 = (await storeBlob(t)) as Id<"_storage">;
    const newFileId2 = (await storeBlob(t)) as Id<"_storage">;

    await expectConvexCode(
      asAlice(t).mutation(
        api.solving.attachCompletionPhotos.attachCompletionPhotos,
        { completionId, storageIds: [newFileId1, newFileId2] },
      ),
      "TooManyPhotos",
    );
    const row = await completionRow(t, completionId);
    expect(row?.photos).toHaveLength(4);
  });

  test("a backdated completion (endDate 10 days ago) can still attach photos", async () => {
    const t = convexTest(schema, modules);
    const { copyAggregateId } = await seed(t);
    const tenDays = 10 * 24 * HOUR;
    const completionId = await recordForAlice(t, copyAggregateId, {
      startDate: Date.now() - tenDays - HOUR,
      endDate: Date.now() - tenDays,
    });
    const fileId = (await storeBlob(t)) as Id<"_storage">;

    await asAlice(t).mutation(
      api.solving.attachCompletionPhotos.attachCompletionPhotos,
      { completionId, storageIds: [fileId] },
    );

    const row = await completionRow(t, completionId);
    expect(row?.photos).toEqual([fileId]);
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

describe("solving.deleteCompletion", () => {
  test("owner can delete their own completion — row is gone", async () => {
    const t = convexTest(schema, modules);
    const { copyAggregateId } = await seed(t);
    const completionId = await recordForAlice(t, copyAggregateId);

    await asAlice(t).mutation(api.solving.deleteCompletion.deleteCompletion, {
      completionId,
    });

    const row = await completionRow(t, completionId);
    expect(row).toBeNull();
  });

  test("non-owner is rejected with NotCompletionOwner — row remains", async () => {
    const t = convexTest(schema, modules);
    const { copyAggregateId } = await seed(t);
    const completionId = await recordForAlice(t, copyAggregateId);

    await expectConvexCode(
      asBob(t).mutation(api.solving.deleteCompletion.deleteCompletion, {
        completionId,
      }),
      "NotCompletionOwner",
    );

    const row = await completionRow(t, completionId);
    expect(row).not.toBeNull();
  });

  test("deleting a completion recomputes goal progress back to 0", async () => {
    const t = convexTest(schema, modules);
    const { copyAggregateId } = await seed(t);

    // Create a goal with target 1.
    const goalId = (await asAlice(t).mutation(
      api.solving.createGoal.createGoal,
      { title: "Solve 1 puzzle", targetCompletions: 1 },
    )) as string;

    // Record a completion — goal progress advances to 1.
    const completionId = await recordForAlice(t, copyAggregateId);
    let row = await goalRow(t, goalId);
    expect(row?.currentCompletions).toBe(1);

    // Delete the completion — goal progress must recompute back to 0.
    await asAlice(t).mutation(api.solving.deleteCompletion.deleteCompletion, {
      completionId,
    });
    row = await goalRow(t, goalId);
    expect(row?.currentCompletions).toBe(0);
  });

  test("deleting a completion removes photo sidecars and best-effort deletes their blobs", async () => {
    const t = convexTest(schema, modules);
    const { copyAggregateId } = await seed(t);
    const completionId = await recordForAlice(t, copyAggregateId);
    const fileId1 = (await storeBlob(t)) as Id<"_storage">;
    const fileId2 = (await storeBlob(t)) as Id<"_storage">;
    await asAlice(t).mutation(
      api.solving.attachCompletionPhotos.attachCompletionPhotos,
      { completionId, storageIds: [fileId1, fileId2] },
    );

    await asAlice(t).mutation(api.solving.deleteCompletion.deleteCompletion, {
      completionId,
    });

    const images = await completionImagesFor(t, completionId);
    expect(images).toHaveLength(0);

    const url1 = await t.run((ctx) => ctx.storage.getUrl(fileId1));
    const url2 = await t.run((ctx) => ctx.storage.getUrl(fileId2));
    expect(url1).toBeNull();
    expect(url2).toBeNull();
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

describe("solving.startCompletion — first-class start", () => {
  test("creates an in-progress row with the copy snapshot and puzzleId denormalized", async () => {
    const t = convexTest(schema, modules);
    const { copyAggregateId, puzzleId } = await seed(t);

    const completionId = (await asAlice(t).mutation(
      api.solving.startCompletion.startCompletion,
      {
        copyId: copyAggregateId,
        startDate: Date.now() - HOUR,
        notes: "corner pieces first",
      },
    )) as string;

    const row = await completionRow(t, completionId);
    expect(row?.isCompleted).toBe(false);
    expect(row?.endDate).toBeUndefined();
    expect(row?.notes).toBe("corner pieces first");
    // Review blocker: without this denormalization every downstream view is title-less.
    expect(row?.puzzleId).toBe(puzzleId);
    expect(row?.copySnapshot?.title).toBe("Mountain Vista");
    expect(row?.copySnapshot?.wasBorrowed).toBe(false);
  });

  test("accepts backdated and future start dates", async () => {
    const t = convexTest(schema, modules);
    const { copyAggregateId } = await seed(t);

    const past = (await asAlice(t).mutation(
      api.solving.startCompletion.startCompletion,
      { copyId: copyAggregateId, startDate: Date.now() - 30 * 24 * HOUR },
    )) as string;
    const future = (await asAlice(t).mutation(
      api.solving.startCompletion.startCompletion,
      { copyId: copyAggregateId, startDate: Date.now() + 3 * 24 * HOUR },
    )) as string;
    expect(await completionRow(t, past)).not.toBeNull();
    expect(await completionRow(t, future)).not.toBeNull();
  });

  test("rejects a member who neither owns nor holds the copy", async () => {
    const t = convexTest(schema, modules);
    const { copyAggregateId } = await seed(t);
    await expect(
      asBob(t).mutation(api.solving.startCompletion.startCompletion, {
        copyId: copyAggregateId,
        startDate: Date.now(),
      }),
    ).rejects.toThrow("Only the owner or current holder");
  });

  test("rejects an unknown copyId", async () => {
    const t = convexTest(schema, modules);
    await seed(t);
    await expect(
      asAlice(t).mutation(api.solving.startCompletion.startCompletion, {
        copyId: crypto.randomUUID(),
        startDate: Date.now(),
      }),
    ).rejects.toThrow("Copy not found");
  });

  test("allows the borrower (current holder) and marks the snapshot borrowed", async () => {
    const t = convexTest(schema, modules);
    const { bob, copyAggregateId, ownedPuzzleId } = await seed(t);
    await lendToBob(t, ownedPuzzleId, bob);

    const completionId = (await asBob(t).mutation(
      api.solving.startCompletion.startCompletion,
      { copyId: copyAggregateId, startDate: Date.now() },
    )) as string;
    const row = await completionRow(t, completionId);
    expect(row?.copySnapshot?.wasBorrowed).toBe(true);
  });

  test("the started solve can be finished via the existing finish flow", async () => {
    const t = convexTest(schema, modules);
    const { copyAggregateId } = await seed(t);
    const completionId = (await asAlice(t).mutation(
      api.solving.startCompletion.startCompletion,
      { copyId: copyAggregateId, startDate: Date.now() - 2 * HOUR },
    )) as string;
    await asAlice(t).mutation(api.solving.finishCompletion.finishCompletion, {
      completionId,
      endDate: Date.now(),
    });
    const row = await completionRow(t, completionId);
    expect(row?.isCompleted).toBe(true);
  });
});

describe("solving.listMyInProgress", () => {
  test("returns only the caller's in-progress solves as DTOs, newest-started first", async () => {
    const t = convexTest(schema, modules);
    const { copyAggregateId } = await seed(t);

    // One finished, two in-progress (started at different times).
    await recordForAlice(t, copyAggregateId);
    const older = (await asAlice(t).mutation(
      api.solving.startCompletion.startCompletion,
      { copyId: copyAggregateId, startDate: Date.now() - 48 * HOUR },
    )) as string;
    const newer = (await asAlice(t).mutation(
      api.solving.startCompletion.startCompletion,
      { copyId: copyAggregateId, startDate: Date.now() - HOUR },
    )) as string;

    const mine = await asAlice(t).query(
      api.solving.listMyInProgress.listMyInProgress,
      {},
    );
    expect(mine.map((s) => s.completionId)).toEqual([newer, older]);
    expect(mine[0].title).toBe("Mountain Vista");
    expect(mine[0].pieceCount).toBe(1000);
    // The DTO never carries notes/photos/raw rows. (Don't assert the full key list — Convex
    // strips undefined-valued fields like thumbnailUrl in serialization.)
    expect("notes" in mine[0]).toBe(false);
    expect("photos" in mine[0]).toBe(false);
    expect("_id" in mine[0]).toBe(false);

    // Bob sees nothing.
    const bobs = await asBob(t).query(
      api.solving.listMyInProgress.listMyInProgress,
      {},
    );
    expect(bobs).toEqual([]);
  });

  test("falls back to the catalog puzzle when the snapshot lacks display data", async () => {
    const t = convexTest(schema, modules);
    const { copyAggregateId, ownedPuzzleId } = await seed(t);
    const completionId = (await asAlice(t).mutation(
      api.solving.startCompletion.startCompletion,
      { copyId: copyAggregateId, startDate: Date.now() },
    )) as string;
    await t.run(async (ctx) => ctx.db.delete(ownedPuzzleId));

    // Strip the snapshot's display fields so "Mountain Vista" / 1000 can only come from the
    // puzzles row via row.puzzleId, not from copySnapshot.
    await t.run(async (ctx) => {
      const row = await ctx.db
        .query("completions")
        .withIndex("by_aggregate_id", (q) => q.eq("aggregateId", completionId))
        .unique();
      const {
        title: _title,
        pieceCount: _pieceCount,
        ...rest
      } = row!.copySnapshot!;
      await ctx.db.patch(row!._id, { copySnapshot: rest });
    });

    const mine = await asAlice(t).query(
      api.solving.listMyInProgress.listMyInProgress,
      {},
    );
    expect(mine).toHaveLength(1);
    expect(mine[0].title).toBe("Mountain Vista"); // from the puzzles row fallback
    expect(mine[0].pieceCount).toBe(1000);
  });

  test("drops legacy in-progress rows that have no aggregateId", async () => {
    const t = convexTest(schema, modules);
    const { alice } = await seed(t);
    await t.run(async (ctx) => {
      const now = Date.now();
      await ctx.db.insert("completions", {
        userId: alice,
        startDate: now,
        photos: [],
        isCompleted: false,
        createdAt: now,
        updatedAt: now,
      });
    });

    const mine = await asAlice(t).query(
      api.solving.listMyInProgress.listMyInProgress,
      {},
    );
    expect(mine).toEqual([]);
  });
});

describe("solving.listMyCompletions — row enrichment", () => {
  // Insert a real-stored ownedPuzzleImages row for a copy and return its id + resolved URL.
  const addCoverPhoto = (
    t: ReturnType<typeof convexTest>,
    copyId: Id<"ownedPuzzles">,
    uploaderId: Id<"users">,
    moderationStatus?: "pending" | "approved" | "rejected",
  ) =>
    t.run(async (ctx) => {
      const fileId = await ctx.storage.store(
        new Blob(["cover-bytes"], { type: "image/png" }),
      );
      const now = Date.now();
      const photoId = await ctx.db.insert("ownedPuzzleImages", {
        ownedPuzzleId: copyId,
        uploaderId,
        fileId,
        createdAt: now,
        updatedAt: now,
        ...(moderationStatus ? { moderationStatus } : {}),
      });
      const url = await ctx.storage.getUrl(fileId);
      return { photoId, url };
    });

  // Insert a bob-owned copy of the seeded puzzle, held by alice (simulating an active loan).
  // `aggregateId` is required even though schema-optional: recordCompletion resolves the copy via
  // `by_aggregate_id`, and throws "Copy not found" without it.
  const insertBobCopyHeldByAlice = (
    t: ReturnType<typeof convexTest>,
    puzzleAggregateId: string,
    puzzleId: Id<"puzzles">,
    bob: Id<"users">,
    alice: Id<"users">,
    availability: { forTrade: boolean; forSale: boolean; forLend: boolean },
  ) => {
    const aggregateId = crypto.randomUUID();
    return t
      .run(async (ctx) => {
        const now = Date.now();
        const id = await ctx.db.insert("ownedPuzzles", {
          aggregateId,
          puzzleDefinitionId: puzzleAggregateId,
          puzzleId,
          ownerId: bob,
          condition: "good",
          availability,
          visibility: "private",
          heldBy: alice,
          createdAt: now,
          updatedAt: now,
        });
        return id;
      })
      .then((id) => ({ aggregateId, id }));
  };

  test("own copy: myCopy link + cover photo preferred over box art", async () => {
    const t = convexTest(schema, modules);
    const { alice, copyAggregateId, ownedPuzzleId } = await seed(t);
    await recordForAlice(t, copyAggregateId);
    const { photoId, url } = await addCoverPhoto(t, ownedPuzzleId, alice);
    await t.run(async (ctx) => {
      await ctx.db.patch(ownedPuzzleId, { coverImageId: photoId });
    });

    const rows = await asAlice(t).query(
      api.solving.listMyCompletions.listMyCompletions,
      {},
    );
    expect(rows).toHaveLength(1);
    expect(rows[0].link).toEqual({
      kind: "myCopy",
      id: ownedPuzzleId as string,
    });
    expect(rows[0].thumbnailUrl).toBe(url);
  });

  test("two completions sharing one copy get the same link/thumbnailUrl (pins the distinct-map fan-out)", async () => {
    const t = convexTest(schema, modules);
    const { alice, copyAggregateId, ownedPuzzleId } = await seed(t);
    await recordForAlice(t, copyAggregateId);
    await recordForAlice(t, copyAggregateId);
    const { photoId, url } = await addCoverPhoto(t, ownedPuzzleId, alice);
    await t.run(async (ctx) => {
      await ctx.db.patch(ownedPuzzleId, { coverImageId: photoId });
    });

    const rows = await asAlice(t).query(
      api.solving.listMyCompletions.listMyCompletions,
      {},
    );
    expect(rows).toHaveLength(2);
    for (const row of rows) {
      expect(row.link).toEqual({ kind: "myCopy", id: ownedPuzzleId as string });
      expect(row.thumbnailUrl).toBe(url);
    }
  });

  test("pending/rejected cover is never used; falls back to box art", async () => {
    const t = convexTest(schema, modules);
    const { alice, copyAggregateId, ownedPuzzleId, puzzleId } = await seed(t);
    await recordForAlice(t, copyAggregateId);

    const boxArtUrl = await t.run(async (ctx) => {
      const fileId = await ctx.storage.store(
        new Blob(["box-art"], { type: "image/png" }),
      );
      await ctx.db.patch(puzzleId, { image: fileId });
      return ctx.storage.getUrl(fileId);
    });

    for (const moderationStatus of ["pending", "rejected"] as const) {
      const { photoId } = await addCoverPhoto(
        t,
        ownedPuzzleId,
        alice,
        moderationStatus,
      );
      await t.run(async (ctx) => {
        await ctx.db.patch(ownedPuzzleId, { coverImageId: photoId });
      });
      const rows = await asAlice(t).query(
        api.solving.listMyCompletions.listMyCompletions,
        {},
      );
      expect(rows[0].thumbnailUrl).toBe(boxArtUrl);
    }
  });

  test("borrowed now (current holder): copy link, pins the heldBy clause through the enrichment", async () => {
    const t = convexTest(schema, modules);
    const { alice, bob, puzzleAggregateId, puzzleId } = await seed(t);
    const { aggregateId, id: bobCopyId } = await insertBobCopyHeldByAlice(
      t,
      puzzleAggregateId,
      puzzleId,
      bob,
      alice,
      { forTrade: false, forSale: false, forLend: false },
    );
    await t.run(async (ctx) => {
      await ctx.db.insert("profiles", {
        memberId: bob,
        displayName: "Bob",
        visibility: "private",
        updatedAt: Date.now(),
      });
    });

    await recordForAlice(t, aggregateId);

    const rows = await asAlice(t).query(
      api.solving.listMyCompletions.listMyCompletions,
      {},
    );
    expect(rows[0].link).toEqual({ kind: "copy", id: bobCopyId as string });
  });

  test("returned + viewable (public profile + open): copy link", async () => {
    const t = convexTest(schema, modules);
    const { alice, bob, puzzleAggregateId, puzzleId } = await seed(t);
    const { aggregateId, id: bobCopyId } = await insertBobCopyHeldByAlice(
      t,
      puzzleAggregateId,
      puzzleId,
      bob,
      alice,
      { forTrade: false, forSale: false, forLend: true },
    );
    await recordForAlice(t, aggregateId);

    await t.run(async (ctx) => {
      await ctx.db.patch(bobCopyId, { heldBy: bob });
      await ctx.db.insert("profiles", {
        memberId: bob,
        displayName: "Bob",
        visibility: "public",
        updatedAt: Date.now(),
      });
    });

    const rows = await asAlice(t).query(
      api.solving.listMyCompletions.listMyCompletions,
      {},
    );
    expect(rows[0].link).toEqual({ kind: "copy", id: bobCopyId as string });
  });

  test("returned + unviewable (private profile, fully closed): definition link + box art, never bob's cover", async () => {
    const t = convexTest(schema, modules);
    const { alice, bob, puzzleAggregateId, puzzleId } = await seed(t);
    const { aggregateId, id: bobCopyId } = await insertBobCopyHeldByAlice(
      t,
      puzzleAggregateId,
      puzzleId,
      bob,
      alice,
      { forTrade: false, forSale: false, forLend: false },
    );
    await recordForAlice(t, aggregateId);

    const boxArtUrl = await t.run(async (ctx) => {
      const fileId = await ctx.storage.store(
        new Blob(["box-art"], { type: "image/png" }),
      );
      await ctx.db.patch(puzzleId, { image: fileId });
      return ctx.storage.getUrl(fileId);
    });

    await t.run(async (ctx) => {
      await ctx.db.patch(bobCopyId, { heldBy: bob });
      await ctx.db.insert("profiles", {
        memberId: bob,
        displayName: "Bob",
        visibility: "private",
        updatedAt: Date.now(),
      });
      // Bob has an approved cover, but it must never surface once the copy is unreachable.
      const now = Date.now();
      const fileId = await ctx.storage.store(
        new Blob(["bob-cover"], { type: "image/png" }),
      );
      const photoId = await ctx.db.insert("ownedPuzzleImages", {
        ownedPuzzleId: bobCopyId,
        uploaderId: bob,
        fileId,
        createdAt: now,
        updatedAt: now,
      });
      await ctx.db.patch(bobCopyId, { coverImageId: photoId });
    });

    const rows = await asAlice(t).query(
      api.solving.listMyCompletions.listMyCompletions,
      {},
    );
    expect(rows[0].link).toEqual({
      kind: "definition",
      id: puzzleId as string,
    });
    expect(rows[0].thumbnailUrl).toBe(boxArtUrl);
  });

  test("copy deleted: definition link; puzzle also deleted: no link, no thumbnail (regression pins)", async () => {
    const t = convexTest(schema, modules);
    const { copyAggregateId, ownedPuzzleId, puzzleId } = await seed(t);
    await recordForAlice(t, copyAggregateId);

    await t.run(async (ctx) => ctx.db.delete(ownedPuzzleId));
    let rows = await asAlice(t).query(
      api.solving.listMyCompletions.listMyCompletions,
      {},
    );
    expect(rows[0].link).toEqual({
      kind: "definition",
      id: puzzleId as string,
    });

    // Regression pin: this half is expected green in both the pre- and post-implementation state.
    await t.run(async (ctx) => ctx.db.delete(puzzleId));
    rows = await asAlice(t).query(
      api.solving.listMyCompletions.listMyCompletions,
      {},
    );
    expect(rows[0].link).toBeUndefined();
    expect(rows[0].thumbnailUrl).toBeUndefined();
  });

  test("orphaned row (no copy, no puzzle anchor): no link, no thumbnail, row still returned (regression pin)", async () => {
    const t = convexTest(schema, modules);
    const { alice } = await seed(t);
    await t.run(async (ctx) => {
      const now = Date.now();
      await ctx.db.insert("completions", {
        userId: alice,
        startDate: now,
        endDate: now,
        isCompleted: true,
        photos: [],
        createdAt: now,
        updatedAt: now,
      });
    });

    const rows = await asAlice(t).query(
      api.solving.listMyCompletions.listMyCompletions,
      {},
    );
    expect(rows).toHaveLength(1);
    expect(rows[0].link).toBeUndefined();
    expect(rows[0].thumbnailUrl).toBeUndefined();
  });
});
