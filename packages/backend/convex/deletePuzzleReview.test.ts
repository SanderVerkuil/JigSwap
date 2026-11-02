import { convexTest, type TestConvex } from "convex-test";
import { ConvexError } from "convex/values";
import { describe, expect, test } from "vitest";
import { api } from "./_generated/api";
import schema from "./schema";

// Bundle every Convex module for the in-memory runtime, excluding test files.
const modules = import.meta.glob(["./**/*.{js,ts}", "!./**/*.test.{js,ts}"]);

// A review list is paged; these tests look at what one generous page says.
const FIRST_PAGE = { numItems: 50, cursor: null };

// SEC-70: a member can delete their own review of a puzzle (stars and text), and only their own.
// listPuzzleReviews says which row is the viewer's (`canDelete`), computed server-side.

const seed = async (t: TestConvex<typeof schema>) =>
  t.run(async (ctx) => {
    const now = Date.now();
    const mkUser = (clerkId: string, email: string, name: string) =>
      ctx.db.insert("users", {
        clerkId,
        email,
        name,
        isActive: true,
        createdAt: now,
        updatedAt: now,
      });
    const alice = await mkUser("clerk_alice", "alice@example.com", "Alice");
    const bob = await mkUser("clerk_bob", "bob@example.com", "Bob");
    const puzzleId = await ctx.db.insert("puzzles", {
      aggregateId: crypto.randomUUID(),
      title: "Mountain Vista",
      pieceCount: 1000,
      status: "approved",
      submittedBy: alice,
      createdAt: now,
      updatedAt: now,
    });
    return { alice, bob, puzzleId };
  });

const asAlice = (t: TestConvex<typeof schema>) =>
  t.withIdentity({ subject: "clerk_alice" });
const asBob = (t: TestConvex<typeof schema>) =>
  t.withIdentity({ subject: "clerk_bob" });

const codeOf = async (promise: Promise<unknown>): Promise<string | null> => {
  try {
    await promise;
    return null;
  } catch (error) {
    if (error instanceof ConvexError) {
      const data: unknown = error.data;
      if (typeof data === "object" && data !== null && "code" in data) {
        return String(data.code);
      }
      return String(data);
    }
    throw error;
  }
};

describe("deletePuzzleReview", () => {
  test("the author deletes their review; the other member's review stays", async () => {
    const t = convexTest(schema, modules);
    const { bob, puzzleId } = await seed(t);
    await asAlice(t).mutation(api.social.postPuzzleReview.postPuzzleReview, {
      puzzleId,
      rating: 4,
      text: "Lovely cut",
    });
    await asBob(t).mutation(api.social.postPuzzleReview.postPuzzleReview, {
      puzzleId,
      rating: 2,
    });

    const asSeenByAlice = await asAlice(t)
      .query(api.social.listPuzzleReviews.listPuzzleReviews, {
        puzzleId,
        paginationOpts: FIRST_PAGE,
      })
      .then((result) => result.page);
    // Told apart by their stars: an author can read as anonymous to the viewer (SEC-11), and
    // canDelete must hold for such a row too.
    const canDeleteByRating = new Map(
      asSeenByAlice.map((r) => [r.rating, r.canDelete]),
    );
    expect(canDeleteByRating.get(4)).toBe(true);
    expect(canDeleteByRating.get(2)).toBe(false);

    await asAlice(t).mutation(
      api.social.deletePuzzleReview.deletePuzzleReview,
      { puzzleId },
    );

    const rows = await t.run((ctx) => ctx.db.query("puzzleReviews").collect());
    expect(rows.map((r) => r.userId)).toEqual([bob]);
    const mine = await asAlice(t).query(api.solving.getMyReviews.getMyReviews, {
      puzzleId,
    });
    expect(mine.puzzle).toBeNull();
    const list = await asBob(t)
      .query(api.social.listPuzzleReviews.listPuzzleReviews, {
        puzzleId,
        paginationOpts: FIRST_PAGE,
      })
      .then((result) => result.page);
    expect(list.map((r) => r.rating)).toEqual([2]);
  });

  test("a member without a review gets PuzzleReviewNotFound and nothing changes", async () => {
    const t = convexTest(schema, modules);
    const { puzzleId } = await seed(t);
    await asAlice(t).mutation(api.social.postPuzzleReview.postPuzzleReview, {
      puzzleId,
      rating: 4,
    });

    expect(
      await codeOf(
        asBob(t).mutation(api.social.deletePuzzleReview.deletePuzzleReview, {
          puzzleId,
        }),
      ),
    ).toBe("PuzzleReviewNotFound");
    await expect(
      t.mutation(api.social.deletePuzzleReview.deletePuzzleReview, {
        puzzleId,
      }),
    ).rejects.toThrow();
    const rows = await t.run((ctx) => ctx.db.query("puzzleReviews").collect());
    expect(rows).toHaveLength(1);
  });
});
