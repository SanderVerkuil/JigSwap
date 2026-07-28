import { convexTest } from "convex-test";
import { ConvexError } from "convex/values";
import { describe, expect, test } from "vitest";
import { api } from "./_generated/api";
import type { Id } from "./_generated/dataModel";
import schema from "./schema";

// Bundle every Convex module for the in-memory runtime, excluding test files.
const modules = import.meta.glob(["./**/*.{js,ts}", "!./**/*.test.{js,ts}"]);

// Seed two members, a catalog puzzle, and an owned copy of it (Alice's) so reviews can target
// the puzzle level, the copy level, or both.
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
    const ownedPuzzleId = await ctx.db.insert("ownedPuzzles", {
      aggregateId: crypto.randomUUID(),
      puzzleId,
      ownerId: alice,
      condition: "good",
      availability: { forTrade: false, forSale: false, forLend: false },
      visibility: "private",
      createdAt: now,
      updatedAt: now,
    });
    return { alice, bob, puzzleId, ownedPuzzleId };
  });

const asAlice = (t: ReturnType<typeof convexTest>) =>
  t.withIdentity({ subject: "clerk_alice" });
const asBob = (t: ReturnType<typeof convexTest>) =>
  t.withIdentity({ subject: "clerk_bob" });

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

// Insert a finished completion row for the member on the copy — the fact the copy-review
// permission check reads via `by_user_owned_puzzle`.
const insertCompletion = (
  t: ReturnType<typeof convexTest>,
  userId: Id<"users">,
  ownedPuzzleId: Id<"ownedPuzzles">,
) =>
  t.run(async (ctx) => {
    const now = Date.now();
    await ctx.db.insert("completions", {
      aggregateId: crypto.randomUUID(),
      userId,
      ownedPuzzleId,
      startDate: now - 1000,
      endDate: now,
      photos: [],
      isCompleted: true,
      createdAt: now,
      updatedAt: now,
    });
  });

describe("solving.submitReviews — puzzle level", () => {
  test("puzzle-only submit writes one row; resubmit updates it in place", async () => {
    const t = convexTest(schema, modules);
    const { alice, puzzleId } = await seed(t);

    await asAlice(t).mutation(api.solving.submitReviews.submitReviews, {
      puzzleId,
      puzzle: { rating: 4, text: "Lovely gradient" },
    });
    let rows = await puzzleReviewsFor(t, alice, puzzleId);
    expect(rows).toHaveLength(1);
    expect(rows[0].rating).toBe(4);
    expect(rows[0].text).toBe("Lovely gradient");

    // Backdate the row so the second submit's timestamps are distinguishable.
    const past = Date.now() - 60_000;
    await t.run(async (ctx) => {
      await ctx.db.patch(rows[0]._id, { createdAt: past, updatedAt: past });
    });

    await asAlice(t).mutation(api.solving.submitReviews.submitReviews, {
      puzzleId,
      puzzle: { rating: 2, text: "Faded on second solve" },
    });
    rows = await puzzleReviewsFor(t, alice, puzzleId);
    expect(rows).toHaveLength(1); // still ONE row — upsert, not insert
    expect(rows[0].rating).toBe(2);
    expect(rows[0].text).toBe("Faded on second solve");
    expect(rows[0].createdAt).toBe(past); // stable
    expect(rows[0].updatedAt).toBeGreaterThan(past); // bumped
  });

  test("cross-mutation cardinality: postPuzzleReview then submitReviews keeps ONE row with the later values", async () => {
    const t = convexTest(schema, modules);
    const { alice, puzzleId } = await seed(t);

    await asAlice(t).mutation(api.social.postPuzzleReview.postPuzzleReview, {
      puzzleId,
      rating: 5,
      text: "From the catalog form",
    });
    await asAlice(t).mutation(api.solving.submitReviews.submitReviews, {
      puzzleId,
      puzzle: { rating: 2, text: "From the review dialog" },
    });

    const rows = await puzzleReviewsFor(t, alice, puzzleId);
    expect(rows).toHaveLength(1); // both mutations upsert the same (member, puzzle) row
    expect(rows[0].rating).toBe(2);
    expect(rows[0].text).toBe("From the review dialog");
  });

  test("neither puzzle nor copy payload => ConvexError", async () => {
    const t = convexTest(schema, modules);
    const { puzzleId } = await seed(t);
    await expect(
      asAlice(t).mutation(api.solving.submitReviews.submitReviews, {
        puzzleId,
      }),
    ).rejects.toBeInstanceOf(ConvexError);
  });
});

describe("solving.submitReviews — copy level", () => {
  test("owner submits both levels in one call => both rows written", async () => {
    const t = convexTest(schema, modules);
    const { alice, puzzleId, ownedPuzzleId } = await seed(t);

    await asAlice(t).mutation(api.solving.submitReviews.submitReviews, {
      puzzleId,
      copyId: ownedPuzzleId,
      puzzle: { rating: 5, text: "Great picture" },
      copy: { rating: 3 },
    });

    const puzzleRows = await puzzleReviewsFor(t, alice, puzzleId);
    expect(puzzleRows).toHaveLength(1);
    expect(puzzleRows[0].rating).toBe(5);
    const copyRows = await copyReviewsFor(t, alice, ownedPuzzleId);
    expect(copyRows).toHaveLength(1);
    expect(copyRows[0].rating).toBe(3);
  });

  test("a borrower with a completion on the copy may review it", async () => {
    const t = convexTest(schema, modules);
    const { bob, puzzleId, ownedPuzzleId } = await seed(t);
    await insertCompletion(t, bob, ownedPuzzleId);

    await asBob(t).mutation(api.solving.submitReviews.submitReviews, {
      puzzleId,
      copyId: ownedPuzzleId,
      copy: { rating: 4 },
    });

    const copyRows = await copyReviewsFor(t, bob, ownedPuzzleId);
    expect(copyRows).toHaveLength(1);
    expect(copyRows[0].rating).toBe(4);
  });

  test("a member with neither ownership nor a completion is rejected", async () => {
    const t = convexTest(schema, modules);
    const { bob, puzzleId, ownedPuzzleId } = await seed(t);

    await expect(
      asBob(t).mutation(api.solving.submitReviews.submitReviews, {
        puzzleId,
        copyId: ownedPuzzleId,
        copy: { rating: 4 },
      }),
    ).rejects.toBeInstanceOf(ConvexError);
    expect(await copyReviewsFor(t, bob, ownedPuzzleId)).toHaveLength(0);
  });

  test("rollback atomicity: a rejected copy level rolls back the puzzle level in the same call", async () => {
    const t = convexTest(schema, modules);
    const { bob, puzzleId, ownedPuzzleId } = await seed(t);

    // Bob is neither the owner nor a completion-holder: the copy level fails permission AFTER
    // the puzzle level was written — the whole mutation (one Convex transaction) must roll back.
    await expect(
      asBob(t).mutation(api.solving.submitReviews.submitReviews, {
        puzzleId,
        copyId: ownedPuzzleId,
        puzzle: { rating: 5, text: "Should not survive" },
        copy: { rating: 4 },
      }),
    ).rejects.toBeInstanceOf(ConvexError);

    expect(await puzzleReviewsFor(t, bob, puzzleId)).toHaveLength(0);
    expect(await copyReviewsFor(t, bob, ownedPuzzleId)).toHaveLength(0);
  });

  test("a copy belonging to a different puzzle => ConvexError (cross-puzzle guard)", async () => {
    const t = convexTest(schema, modules);
    const { alice, ownedPuzzleId } = await seed(t);
    const otherPuzzleId = await t.run(async (ctx) => {
      const now = Date.now();
      return ctx.db.insert("puzzles", {
        aggregateId: crypto.randomUUID(),
        title: "Ocean Sunset",
        brand: "Schmidt",
        pieceCount: 500,
        searchableText: "Ocean Sunset Schmidt",
        status: "approved",
        submittedBy: alice,
        createdAt: now,
        updatedAt: now,
      });
    });

    await expect(
      asAlice(t).mutation(api.solving.submitReviews.submitReviews, {
        puzzleId: otherPuzzleId,
        copyId: ownedPuzzleId, // copy of the OTHER (seeded) puzzle
        copy: { rating: 3 },
      }),
    ).rejects.toBeInstanceOf(ConvexError);
    expect(await copyReviewsFor(t, alice, ownedPuzzleId)).toHaveLength(0);
  });

  test("a dangling copyId (copy deleted) => ConvexError", async () => {
    const t = convexTest(schema, modules);
    const { puzzleId, ownedPuzzleId } = await seed(t);
    await t.run(async (ctx) => ctx.db.delete(ownedPuzzleId));

    await expect(
      asAlice(t).mutation(api.solving.submitReviews.submitReviews, {
        puzzleId,
        copyId: ownedPuzzleId,
        copy: { rating: 3 },
      }),
    ).rejects.toBeInstanceOf(ConvexError);
  });

  test("a copy payload without copyId => ConvexError", async () => {
    const t = convexTest(schema, modules);
    const { puzzleId } = await seed(t);
    await expect(
      asAlice(t).mutation(api.solving.submitReviews.submitReviews, {
        puzzleId,
        copy: { rating: 3 },
      }),
    ).rejects.toBeInstanceOf(ConvexError);
  });
});

describe("solving.getMyReviews", () => {
  test("returns the caller's own rows only — another member's reviews never leak", async () => {
    const t = convexTest(schema, modules);
    const { bob, puzzleId, ownedPuzzleId } = await seed(t);

    // Alice (owner) reviews both levels.
    await asAlice(t).mutation(api.solving.submitReviews.submitReviews, {
      puzzleId,
      copyId: ownedPuzzleId,
      puzzle: { rating: 5, text: "Great picture" },
      copy: { rating: 3 },
    });

    // Bob has no reviews: both levels come back null.
    const bobView = await asBob(t).query(
      api.solving.getMyReviews.getMyReviews,
      {
        puzzleId,
        copyId: ownedPuzzleId,
      },
    );
    expect(bobView.puzzle).toBeNull();
    expect(bobView.copy).toBeNull();

    // Bob (with a completion) writes his own — he sees only his values.
    await insertCompletion(t, bob, ownedPuzzleId);
    await asBob(t).mutation(api.solving.submitReviews.submitReviews, {
      puzzleId,
      copyId: ownedPuzzleId,
      puzzle: { rating: 2 },
      copy: { rating: 1 },
    });
    const bobAfter = await asBob(t).query(
      api.solving.getMyReviews.getMyReviews,
      { puzzleId, copyId: ownedPuzzleId },
    );
    expect(bobAfter.puzzle).toEqual({ rating: 2, text: null });
    expect(bobAfter.copy).toEqual({ rating: 1 });

    // Alice still sees hers, untouched.
    const aliceView = await asAlice(t).query(
      api.solving.getMyReviews.getMyReviews,
      { puzzleId, copyId: ownedPuzzleId },
    );
    expect(aliceView.puzzle).toEqual({ rating: 5, text: "Great picture" });
    expect(aliceView.copy).toEqual({ rating: 3 });
  });

  test("copyReviewAllowed: false without copyId, for a deleted copy, and for an unpermitted member", async () => {
    const t = convexTest(schema, modules);
    const { puzzleId, ownedPuzzleId } = await seed(t);

    // No copyId supplied.
    const noCopy = await asAlice(t).query(
      api.solving.getMyReviews.getMyReviews,
      { puzzleId },
    );
    expect(noCopy.copyReviewAllowed).toBe(false);

    // Bob neither owns the copy nor completed it.
    const bobView = await asBob(t).query(
      api.solving.getMyReviews.getMyReviews,
      {
        puzzleId,
        copyId: ownedPuzzleId,
      },
    );
    expect(bobView.copyReviewAllowed).toBe(false);

    // Copy doc deleted: even the owner gets false.
    await t.run(async (ctx) => ctx.db.delete(ownedPuzzleId));
    const deleted = await asAlice(t).query(
      api.solving.getMyReviews.getMyReviews,
      { puzzleId, copyId: ownedPuzzleId },
    );
    expect(deleted.copyReviewAllowed).toBe(false);
  });

  test("copyReviewAllowed: true for the owner and for a completion-holder", async () => {
    const t = convexTest(schema, modules);
    const { bob, puzzleId, ownedPuzzleId } = await seed(t);

    const ownerView = await asAlice(t).query(
      api.solving.getMyReviews.getMyReviews,
      { puzzleId, copyId: ownedPuzzleId },
    );
    expect(ownerView.copyReviewAllowed).toBe(true);

    await insertCompletion(t, bob, ownedPuzzleId);
    const holderView = await asBob(t).query(
      api.solving.getMyReviews.getMyReviews,
      { puzzleId, copyId: ownedPuzzleId },
    );
    expect(holderView.copyReviewAllowed).toBe(true);
  });
});
