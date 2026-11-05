import { convexTest, type TestConvex } from "convex-test";
import { ConvexError } from "convex/values";
import { describe, expect, test } from "vitest";
import { api } from "./_generated/api";
import schema from "./schema";

// Bundle every Convex module for the in-memory runtime, excluding test files.
const modules = import.meta.glob(["./**/*.{js,ts}", "!./**/*.test.{js,ts}"]);

// SEC-70: a member can delete their own star review of a copy, and only their own. The copy
// page says which row is the viewer's (`canDelete`), computed server-side.

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
    const copyId = await ctx.db.insert("ownedPuzzles", {
      aggregateId: crypto.randomUUID(),
      puzzleId,
      ownerId: alice,
      condition: "good",
      availability: { forTrade: false, forSale: false, forLend: false },
      createdAt: now,
      updatedAt: now,
    });
    // Bob solved Alice's copy once and rated it; his row is seeded directly.
    await ctx.db.insert("copyReviews", {
      userId: bob,
      copyId,
      rating: 2,
      createdAt: now,
      updatedAt: now,
    });
    return { alice, bob, puzzleId, copyId };
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

describe("deleteCopyReview", () => {
  test("the author deletes their review; the other member's review stays", async () => {
    const t = convexTest(schema, modules);
    const { bob, puzzleId, copyId } = await seed(t);
    await asAlice(t).mutation(api.solving.submitReviews.submitReviews, {
      puzzleId,
      copyId,
      copy: { rating: 4 },
    });

    const before = await asAlice(t).query(
      api.library.getCopyInstanceView.getCopyInstanceView,
      { copyId },
    );
    const canDeleteByRating = new Map(
      (before?.copyReviews ?? []).map((r) => [r.rating, r.canDelete]),
    );
    expect(canDeleteByRating).toEqual(
      new Map([
        [4, true],
        [2, false],
      ]),
    );
    expect(before?.stats.yourCopyRating).toBe(4);

    await asAlice(t).mutation(api.solving.deleteCopyReview.deleteCopyReview, {
      copyId,
    });

    const rows = await t.run((ctx) => ctx.db.query("copyReviews").collect());
    expect(rows.map((r) => r.userId)).toEqual([bob]);
    const after = await asAlice(t).query(
      api.library.getCopyInstanceView.getCopyInstanceView,
      { copyId },
    );
    expect(after?.stats.yourCopyRating).toBeNull();
    expect(after?.copyReviews.map((r) => [r.rating, r.canDelete])).toEqual([
      [2, false],
    ]);
    const mine = await asAlice(t).query(api.solving.getMyReviews.getMyReviews, {
      puzzleId,
      copyId,
    });
    expect(mine.copy).toBeNull();
  });

  test("the copy owner cannot reach another member's review; a member without one gets CopyReviewNotFound", async () => {
    const t = convexTest(schema, modules);
    const { copyId } = await seed(t);

    // Alice owns the copy but never rated it: her delete names only her own (absent) row.
    expect(
      await codeOf(
        asAlice(t).mutation(api.solving.deleteCopyReview.deleteCopyReview, {
          copyId,
        }),
      ),
    ).toBe("CopyReviewNotFound");
    await expect(
      t.mutation(api.solving.deleteCopyReview.deleteCopyReview, { copyId }),
    ).rejects.toThrow();

    const rows = await t.run((ctx) => ctx.db.query("copyReviews").collect());
    expect(rows).toHaveLength(1);

    // Bob can still delete his own.
    await asBob(t).mutation(api.solving.deleteCopyReview.deleteCopyReview, {
      copyId,
    });
    const left = await t.run((ctx) => ctx.db.query("copyReviews").collect());
    expect(left).toHaveLength(0);
  });
});
