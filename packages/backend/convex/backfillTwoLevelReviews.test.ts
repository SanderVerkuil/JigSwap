import { convexTest } from "convex-test";
import { describe, expect, test } from "vitest";
import { internal } from "./_generated/api";
import type { Id } from "./_generated/dataModel";
import schema from "./schema";

// Bundle every Convex module for the in-memory runtime, excluding test files.
const modules = import.meta.glob(["./**/*.{js,ts}", "!./**/*.test.{js,ts}"]);

// Seed two members, a catalog puzzle, and an owned copy of it (Alice's) so legacy data can
// target the puzzle level, the copy level, or both.
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
    const puzzleId = await ctx.db.insert("puzzles", {
      aggregateId: crypto.randomUUID(),
      title: "Mountain Vista",
      brand: "Ravensburger",
      pieceCount: 1000,
      searchableText: "Mountain Vista Ravensburger",
      status: "approved",
      submittedBy: alice,
      createdAt: now,
      updatedAt: now,
    });
    const copyId = await ctx.db.insert("ownedPuzzles", {
      aggregateId: crypto.randomUUID(),
      puzzleId,
      ownerId: alice,
      condition: "good",
      availability: { forTrade: false, forSale: false, forLend: false },
      visibility: "private",
      createdAt: now,
      updatedAt: now,
    });
    return { alice, bob, puzzleId, copyId };
  });

// Legacy completion row. `updatedAt` is the candidate timestamp the migration reads.
const insertCompletion = (
  t: ReturnType<typeof convexTest>,
  args: {
    userId: Id<"users">;
    puzzleId?: Id<"puzzles">;
    ownedPuzzleId?: Id<"ownedPuzzles">;
    rating?: number;
    review?: string;
    updatedAt: number;
  },
) =>
  t.run(async (ctx) =>
    ctx.db.insert("completions", {
      aggregateId: crypto.randomUUID(),
      userId: args.userId,
      ...(args.puzzleId ? { puzzleId: args.puzzleId } : {}),
      ...(args.ownedPuzzleId ? { ownedPuzzleId: args.ownedPuzzleId } : {}),
      ...(args.rating !== undefined ? { rating: args.rating } : {}),
      ...(args.review !== undefined ? { review: args.review } : {}),
      startDate: args.updatedAt - 1000,
      endDate: args.updatedAt,
      photos: [],
      isCompleted: true,
      createdAt: args.updatedAt,
      updatedAt: args.updatedAt,
    }),
  );

// Legacy comment row. `_creationTime` (assigned by the runtime) is the candidate timestamp;
// the helper returns it so tests can order completions relative to the comment.
const insertComment = (
  t: ReturnType<typeof convexTest>,
  args: {
    puzzleId: Id<"puzzles">;
    authorId: Id<"users">;
    text: string;
    rating?: number;
    copyId?: Id<"ownedPuzzles">;
  },
) =>
  t.run(async (ctx) => {
    const id = await ctx.db.insert("puzzleComments", {
      aggregateId: crypto.randomUUID(),
      puzzleId: args.puzzleId,
      ...(args.copyId ? { copyId: args.copyId } : {}),
      authorId: args.authorId,
      text: args.text,
      ...(args.rating !== undefined ? { rating: args.rating } : {}),
      createdAt: Date.now(),
    });
    const doc = await ctx.db.get(id);
    return { id, creationTime: doc!._creationTime };
  });

const run = (t: ReturnType<typeof convexTest>) =>
  t.mutation(
    internal.solving.backfillTwoLevelReviews.backfillTwoLevelReviews,
    {},
  );

const puzzleReviewsFor = (
  t: ReturnType<typeof convexTest>,
  userId: Id<"users">,
  puzzleId: Id<"puzzles">,
) =>
  t.run(async (ctx) =>
    ctx.db
      .query("puzzleReviews")
      .withIndex("by_user_puzzle", (q) =>
        q.eq("userId", userId).eq("puzzleId", puzzleId),
      )
      .collect(),
  );

const copyReviewsFor = (
  t: ReturnType<typeof convexTest>,
  userId: Id<"users">,
  copyId: Id<"ownedPuzzles">,
) =>
  t.run(async (ctx) =>
    ctx.db
      .query("copyReviews")
      .withIndex("by_user_copy", (q) =>
        q.eq("userId", userId).eq("copyId", copyId),
      )
      .collect(),
  );

describe("solving/backfillTwoLevelReviews — puzzle level", () => {
  test("(a) rated completion only => one puzzleReviews row carrying its rating and review text", async () => {
    const t = convexTest(schema, modules);
    const { alice, puzzleId } = await seed(t);
    const ts = Date.now() - 50_000;
    await insertCompletion(t, {
      userId: alice,
      puzzleId,
      rating: 4,
      review: "Lovely gradient",
      updatedAt: ts,
    });

    const summary = await run(t);
    expect(summary).toEqual({
      puzzleReviewsCreated: 1,
      copyReviewsCreated: 0,
      completionsCleaned: 1,
      commentsCleaned: 0,
      definitionCommentsDeleted: 0,
    });

    const rows = await puzzleReviewsFor(t, alice, puzzleId);
    expect(rows).toHaveLength(1);
    expect(rows[0].rating).toBe(4);
    expect(rows[0].text).toBe("Lovely gradient");
    expect(rows[0].createdAt).toBe(ts);
    expect(rows[0].updatedAt).toBe(ts);
  });

  test("(b) rated definition comment only => row with its rating and text at its _creationTime", async () => {
    const t = convexTest(schema, modules);
    const { alice, puzzleId } = await seed(t);
    const { creationTime } = await insertComment(t, {
      puzzleId,
      authorId: alice,
      text: "Community review",
      rating: 3,
    });

    const summary = await run(t);
    expect(summary).toEqual({
      puzzleReviewsCreated: 1,
      copyReviewsCreated: 0,
      completionsCleaned: 0,
      commentsCleaned: 0,
      definitionCommentsDeleted: 1,
    });

    const rows = await puzzleReviewsFor(t, alice, puzzleId);
    expect(rows).toHaveLength(1);
    expect(rows[0].rating).toBe(3);
    expect(rows[0].text).toBe("Community review");
    expect(rows[0].createdAt).toBe(creationTime);
    expect(rows[0].updatedAt).toBe(creationTime);
  });

  test("(c) newest candidate wins both fields — completion newer than comment", async () => {
    const t = convexTest(schema, modules);
    const { alice, puzzleId } = await seed(t);
    const { creationTime } = await insertComment(t, {
      puzzleId,
      authorId: alice,
      text: "Older comment",
      rating: 2,
    });
    const newer = creationTime + 60_000;
    await insertCompletion(t, {
      userId: alice,
      puzzleId,
      rating: 5,
      review: "Newer completion",
      updatedAt: newer,
    });

    await run(t);
    const rows = await puzzleReviewsFor(t, alice, puzzleId);
    expect(rows).toHaveLength(1);
    expect(rows[0].rating).toBe(5);
    expect(rows[0].text).toBe("Newer completion");
    expect(rows[0].createdAt).toBe(newer);
    expect(rows[0].updatedAt).toBe(newer);
  });

  test("(c) newest candidate wins both fields — comment newer than completion", async () => {
    const t = convexTest(schema, modules);
    const { alice, puzzleId } = await seed(t);
    await insertCompletion(t, {
      userId: alice,
      puzzleId,
      rating: 5,
      review: "Older completion",
      updatedAt: Date.now() - 600_000,
    });
    const { creationTime } = await insertComment(t, {
      puzzleId,
      authorId: alice,
      text: "Newer comment",
      rating: 2,
    });

    await run(t);
    const rows = await puzzleReviewsFor(t, alice, puzzleId);
    expect(rows).toHaveLength(1);
    expect(rows[0].rating).toBe(2);
    expect(rows[0].text).toBe("Newer comment");
    expect(rows[0].createdAt).toBe(creationTime);
    expect(rows[0].updatedAt).toBe(creationTime);
  });

  test("(d) newer text-only comment + older rated completion => completion's rating AND comment's text", async () => {
    const t = convexTest(schema, modules);
    const { alice, puzzleId } = await seed(t);
    await insertCompletion(t, {
      userId: alice,
      puzzleId,
      rating: 4,
      review: "Old review text",
      updatedAt: Date.now() - 600_000,
    });
    const { creationTime } = await insertComment(t, {
      puzzleId,
      authorId: alice,
      text: "New text without stars",
      // no rating — text-only community comment
    });

    await run(t);
    const rows = await puzzleReviewsFor(t, alice, puzzleId);
    expect(rows).toHaveLength(1);
    expect(rows[0].rating).toBe(4); // newest candidate WITH a rating
    expect(rows[0].text).toBe("New text without stars"); // newest candidate WITH text
    expect(rows[0].createdAt).toBe(creationTime); // newest contributing candidate overall
    expect(rows[0].updatedAt).toBe(creationTime);
  });

  test("(e) text-only comment alone => text-only row, rating undefined", async () => {
    const t = convexTest(schema, modules);
    const { alice, puzzleId } = await seed(t);
    await insertComment(t, {
      puzzleId,
      authorId: alice,
      text: "Just words",
    });

    const summary = await run(t);
    expect(summary.puzzleReviewsCreated).toBe(1);

    const rows = await puzzleReviewsFor(t, alice, puzzleId);
    expect(rows).toHaveLength(1);
    expect(rows[0].rating).toBeUndefined();
    expect(rows[0].text).toBe("Just words");
  });

  test("(h) completion without puzzleId is skipped at puzzle level but counted at copy level", async () => {
    const t = convexTest(schema, modules);
    const { alice, puzzleId, copyId } = await seed(t);
    await insertCompletion(t, {
      userId: alice,
      ownedPuzzleId: copyId, // no puzzleId
      rating: 3,
      updatedAt: Date.now() - 5_000,
    });

    const summary = await run(t);
    expect(summary).toEqual({
      puzzleReviewsCreated: 0,
      copyReviewsCreated: 1,
      completionsCleaned: 1,
      commentsCleaned: 0,
      definitionCommentsDeleted: 0,
    });
    expect(await puzzleReviewsFor(t, alice, puzzleId)).toHaveLength(0);
    const copyRows = await copyReviewsFor(t, alice, copyId);
    expect(copyRows).toHaveLength(1);
    expect(copyRows[0].rating).toBe(3);
  });

  test("(k) multi-member isolation: two members' candidates never merge", async () => {
    const t = convexTest(schema, modules);
    const { alice, bob, puzzleId } = await seed(t);
    await insertCompletion(t, {
      userId: alice,
      puzzleId,
      rating: 5,
      review: "Alice loved it",
      updatedAt: Date.now() - 20_000,
    });
    await insertCompletion(t, {
      userId: bob,
      puzzleId,
      rating: 2,
      review: "Bob did not",
      updatedAt: Date.now() - 10_000,
    });

    const summary = await run(t);
    expect(summary.puzzleReviewsCreated).toBe(2);

    const aliceRows = await puzzleReviewsFor(t, alice, puzzleId);
    expect(aliceRows).toHaveLength(1);
    expect(aliceRows[0].rating).toBe(5);
    expect(aliceRows[0].text).toBe("Alice loved it");
    const bobRows = await puzzleReviewsFor(t, bob, puzzleId);
    expect(bobRows).toHaveLength(1);
    expect(bobRows[0].rating).toBe(2);
    expect(bobRows[0].text).toBe("Bob did not");
  });
});

describe("solving/backfillTwoLevelReviews — copy level", () => {
  test("(f) newer rated copy-scoped comment beats older rated completion", async () => {
    const t = convexTest(schema, modules);
    const { alice, puzzleId, copyId } = await seed(t);
    await insertCompletion(t, {
      userId: alice,
      ownedPuzzleId: copyId,
      rating: 2,
      updatedAt: Date.now() - 600_000,
    });
    const { creationTime } = await insertComment(t, {
      puzzleId,
      authorId: alice,
      text: "Copy notes",
      rating: 5,
      copyId,
    });

    const summary = await run(t);
    expect(summary.copyReviewsCreated).toBe(1);

    const rows = await copyReviewsFor(t, alice, copyId);
    expect(rows).toHaveLength(1);
    expect(rows[0].rating).toBe(5);
    expect(rows[0].createdAt).toBe(creationTime);
    expect(rows[0].updatedAt).toBe(creationTime);
  });

  test("(f) newer rated completion beats older rated copy-scoped comment", async () => {
    const t = convexTest(schema, modules);
    const { alice, puzzleId, copyId } = await seed(t);
    const { creationTime } = await insertComment(t, {
      puzzleId,
      authorId: alice,
      text: "Copy notes",
      rating: 5,
      copyId,
    });
    const newer = creationTime + 60_000;
    await insertCompletion(t, {
      userId: alice,
      ownedPuzzleId: copyId,
      rating: 2,
      updatedAt: newer,
    });

    await run(t);
    const rows = await copyReviewsFor(t, alice, copyId);
    expect(rows).toHaveLength(1);
    expect(rows[0].rating).toBe(2);
    expect(rows[0].createdAt).toBe(newer);
    expect(rows[0].updatedAt).toBe(newer);
  });

  test("(g) candidate whose copy was deleted => no copyReviews row, still counted at puzzle level", async () => {
    const t = convexTest(schema, modules);
    const { alice, puzzleId, copyId } = await seed(t);
    await insertCompletion(t, {
      userId: alice,
      puzzleId,
      ownedPuzzleId: copyId,
      rating: 4,
      review: "Solved on a copy that is now gone",
      updatedAt: Date.now() - 5_000,
    });
    await t.run(async (ctx) => ctx.db.delete(copyId));

    const summary = await run(t);
    expect(summary).toEqual({
      puzzleReviewsCreated: 1,
      copyReviewsCreated: 0,
      completionsCleaned: 1,
      commentsCleaned: 0,
      definitionCommentsDeleted: 0,
    });
    expect(await copyReviewsFor(t, alice, copyId)).toHaveLength(0);
    const puzzleRows = await puzzleReviewsFor(t, alice, puzzleId);
    expect(puzzleRows).toHaveLength(1);
    expect(puzzleRows[0].rating).toBe(4);
  });
});

describe("solving/backfillTwoLevelReviews — cleanup & idempotency", () => {
  test("(i) cleanup: completion ratings unset, copy-comment ratings unset, definition comments deleted, copy comments kept", async () => {
    const t = convexTest(schema, modules);
    const { alice, puzzleId, copyId } = await seed(t);
    const completionId = await insertCompletion(t, {
      userId: alice,
      puzzleId,
      ownedPuzzleId: copyId,
      rating: 4,
      review: "Legacy review",
      updatedAt: Date.now() - 20_000,
    });
    const definitionComment = await insertComment(t, {
      puzzleId,
      authorId: alice,
      text: "Definition-scoped",
      rating: 3,
    });
    const copyComment = await insertComment(t, {
      puzzleId,
      authorId: alice,
      text: "Copy-scoped, keep me",
      rating: 5,
      copyId,
    });

    const summary = await run(t);
    expect(summary).toEqual({
      puzzleReviewsCreated: 1,
      copyReviewsCreated: 1,
      completionsCleaned: 1,
      commentsCleaned: 1,
      definitionCommentsDeleted: 1,
    });

    const completion = await t.run(async (ctx) => ctx.db.get(completionId));
    expect(completion?.rating).toBeUndefined();
    expect(completion?.review).toBeUndefined();

    const defDoc = await t.run(async (ctx) => ctx.db.get(definitionComment.id));
    expect(defDoc).toBeNull(); // definition-scoped comments are DELETED

    const copyDoc = await t.run(async (ctx) => ctx.db.get(copyComment.id));
    expect(copyDoc).not.toBeNull(); // copy-scoped comments are KEPT
    expect(copyDoc?.rating).toBeUndefined(); // ...but their rating is unset
    expect(copyDoc?.text).toBe("Copy-scoped, keep me");
  });

  test("(j) running twice: second run reports zeros and changes nothing", async () => {
    const t = convexTest(schema, modules);
    const { alice, puzzleId, copyId } = await seed(t);
    await insertCompletion(t, {
      userId: alice,
      puzzleId,
      ownedPuzzleId: copyId,
      rating: 4,
      review: "Legacy review",
      updatedAt: Date.now() - 20_000,
    });
    await insertComment(t, {
      puzzleId,
      authorId: alice,
      text: "Copy-scoped",
      rating: 5,
      copyId,
    });

    const first = await run(t);
    expect(first.puzzleReviewsCreated).toBe(1);
    expect(first.copyReviewsCreated).toBe(1);

    const second = await run(t);
    expect(second).toEqual({
      puzzleReviewsCreated: 0,
      copyReviewsCreated: 0,
      completionsCleaned: 0,
      commentsCleaned: 0,
      definitionCommentsDeleted: 0,
    });
    expect(await puzzleReviewsFor(t, alice, puzzleId)).toHaveLength(1);
    expect(await copyReviewsFor(t, alice, copyId)).toHaveLength(1);
  });

  test("(j) a pre-existing puzzleReviews row is NOT overwritten (live-app upserts win)", async () => {
    const t = convexTest(schema, modules);
    const { alice, puzzleId } = await seed(t);
    const appTs = Date.now() - 1_000;
    await t.run(async (ctx) => {
      await ctx.db.insert("puzzleReviews", {
        userId: alice,
        puzzleId,
        rating: 1,
        text: "Written by the live app",
        createdAt: appTs,
        updatedAt: appTs,
      });
    });
    await insertCompletion(t, {
      userId: alice,
      puzzleId,
      rating: 5,
      review: "Legacy",
      updatedAt: Date.now(),
    });

    const summary = await run(t);
    expect(summary.puzzleReviewsCreated).toBe(0);
    expect(summary.completionsCleaned).toBe(1); // legacy columns still cleaned

    const rows = await puzzleReviewsFor(t, alice, puzzleId);
    expect(rows).toHaveLength(1);
    expect(rows[0].rating).toBe(1);
    expect(rows[0].text).toBe("Written by the live app");
    expect(rows[0].createdAt).toBe(appTs);
    expect(rows[0].updatedAt).toBe(appTs);
  });
});
