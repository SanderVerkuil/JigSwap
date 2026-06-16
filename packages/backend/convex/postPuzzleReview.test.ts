import { convexTest } from "convex-test";
import { ConvexError } from "convex/values";
import { describe, expect, test } from "vitest";
import { api } from "./_generated/api";
import schema from "./schema";

// Bundle every Convex module for the in-memory runtime, excluding test files.
const modules = import.meta.glob(["./**/*.{js,ts}", "!./**/*.test.{js,ts}"]);

// Seed one member + ONE approved catalog puzzle. Reviews key by the puzzle DEFINITION id directly
// (the catalog detail page has no copy id), and share the `puzzleComments` table with the copy-keyed
// comment functions.
const seed = async (t: ReturnType<typeof convexTest>) =>
  t.run(async (ctx) => {
    const now = Date.now();
    const alice = await ctx.db.insert("users", {
      clerkId: "clerk_alice",
      email: "alice@example.com",
      name: "Alice",
      isActive: true,
      createdAt: now,
      updatedAt: now,
    });
    const puzzleId = await ctx.db.insert("puzzles", {
      aggregateId: crypto.randomUUID(),
      title: "Mountain Vista",
      pieceCount: 1000,
      status: "approved",
      submittedBy: alice,
      createdAt: now,
      updatedAt: now,
    });
    return { alice, puzzleId };
  });

const asAlice = (t: ReturnType<typeof convexTest>) =>
  t.withIdentity({ subject: "clerk_alice" });

describe("postPuzzleReview / listPuzzleReviews", () => {
  test("posts a review by puzzleId; list returns it with the real author", async () => {
    const t = convexTest(schema, modules);
    const { alice, puzzleId } = await seed(t);

    await asAlice(t).mutation(api.social.postPuzzleReview.postPuzzleReview, {
      puzzleId,
      text: "Stunning artwork",
      rating: 5,
    });

    // Persisted under the catalog puzzleId.
    const stored = await t.run((ctx) =>
      ctx.db.query("puzzleComments").collect(),
    );
    expect(stored).toHaveLength(1);
    expect(stored[0].puzzleId).toBe(puzzleId);
    expect(stored[0].rating).toBe(5);
    expect(stored[0].aggregateId).toBeDefined();

    const list = await asAlice(t).query(
      api.social.listPuzzleReviews.listPuzzleReviews,
      { puzzleId },
    );
    expect(list).toHaveLength(1);
    expect(list[0].text).toBe("Stunning artwork");
    expect(list[0].rating).toBe(5);
    // Real author identity — never anonymised.
    expect(list[0].author._id).toBe(alice as string);
    expect(list[0].author.name).toBe("Alice");
  });

  test("posts a review without a rating; list surfaces rating null", async () => {
    const t = convexTest(schema, modules);
    const { puzzleId } = await seed(t);

    await asAlice(t).mutation(api.social.postPuzzleReview.postPuzzleReview, {
      puzzleId,
      text: "No stars from me",
    });

    const list = await asAlice(t).query(
      api.social.listPuzzleReviews.listPuzzleReviews,
      { puzzleId },
    );
    expect(list).toHaveLength(1);
    expect(list[0].rating).toBeNull();
  });

  test("reviews are returned newest-first", async () => {
    const t = convexTest(schema, modules);
    const { puzzleId } = await seed(t);

    await asAlice(t).mutation(api.social.postPuzzleReview.postPuzzleReview, {
      puzzleId,
      text: "first",
    });
    await asAlice(t).mutation(api.social.postPuzzleReview.postPuzzleReview, {
      puzzleId,
      text: "second",
    });

    const list = await asAlice(t).query(
      api.social.listPuzzleReviews.listPuzzleReviews,
      { puzzleId },
    );
    expect(list.map((c) => c.text)).toEqual(["second", "first"]);
  });

  test("empty / whitespace-only text is rejected", async () => {
    const t = convexTest(schema, modules);
    const { puzzleId } = await seed(t);

    await expect(
      asAlice(t).mutation(api.social.postPuzzleReview.postPuzzleReview, {
        puzzleId,
        text: "   ",
      }),
    ).rejects.toThrow(ConvexError);

    const stored = await t.run((ctx) =>
      ctx.db.query("puzzleComments").collect(),
    );
    expect(stored).toHaveLength(0);
  });

  test("a rating out of range is rejected", async () => {
    const t = convexTest(schema, modules);
    const { puzzleId } = await seed(t);

    await expect(
      asAlice(t).mutation(api.social.postPuzzleReview.postPuzzleReview, {
        puzzleId,
        text: "ok",
        rating: 6,
      }),
    ).rejects.toThrow(ConvexError);
  });

  test("auth is required to post a review", async () => {
    const t = convexTest(schema, modules);
    const { puzzleId } = await seed(t);

    await expect(
      t.mutation(api.social.postPuzzleReview.postPuzzleReview, {
        puzzleId,
        text: "anon",
      }),
    ).rejects.toThrow(ConvexError);
  });

  // SECURITY: listPuzzleReviews projects each author through `toMemberView`, exposing member
  // identity (name/username/bio/location) meant only for OTHER AUTHENTICATED MEMBERS. An
  // unauthenticated caller must be rejected so that PII never leaks to anonymous clients.
  test("auth is required to list reviews (no anonymous PII exposure)", async () => {
    const t = convexTest(schema, modules);
    const { puzzleId } = await seed(t);

    await asAlice(t).mutation(api.social.postPuzzleReview.postPuzzleReview, {
      puzzleId,
      text: "Stunning artwork",
      rating: 5,
    });

    await expect(
      t.query(api.social.listPuzzleReviews.listPuzzleReviews, { puzzleId }),
    ).rejects.toThrow(ConvexError);
  });
});
