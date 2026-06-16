import { convexTest } from "convex-test";
import { ConvexError } from "convex/values";
import { describe, expect, test } from "vitest";
import { api } from "./_generated/api";
import type { Id } from "./_generated/dataModel";
import schema from "./schema";

// Bundle every Convex module for the in-memory runtime, excluding test files.
const modules = import.meta.glob(["./**/*.{js,ts}", "!./**/*.test.{js,ts}"]);

// Seed two members + ONE catalog puzzle + two owned copies of THAT SAME puzzle (one Alice's, one
// Bob's). Comments are COPY-scoped, so each copy surfaces only its own list (and they never leak
// into the shared puzzle's community reviews).
const seed = async (t: ReturnType<typeof convexTest>) =>
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

    const mkCopy = (ownerId: Id<"users">) =>
      ctx.db.insert("ownedPuzzles", {
        puzzleId,
        ownerId,
        condition: "good",
        availability: { forTrade: false, forSale: false, forLend: false },
        createdAt: now,
        updatedAt: now,
      });
    const aliceCopy = await mkCopy(alice);
    const bobCopy = await mkCopy(bob);
    return { alice, bob, puzzleId, aliceCopy, bobCopy };
  });

const asAlice = (t: ReturnType<typeof convexTest>) =>
  t.withIdentity({ subject: "clerk_alice" });
const asBob = (t: ReturnType<typeof convexTest>) =>
  t.withIdentity({ subject: "clerk_bob" });

describe("postPuzzleComment / listPuzzleComments", () => {
  test("posts a comment with a rating; list returns it with the real author", async () => {
    const t = convexTest(schema, modules);
    const { alice, puzzleId, aliceCopy } = await seed(t);

    await asAlice(t).mutation(api.social.postPuzzleComment.postPuzzleComment, {
      copyId: aliceCopy,
      text: "Beautiful cut",
      rating: 5,
    });

    // Persisted with the catalog puzzleId (for context) AND scoped to the owned copy.
    const stored = await t.run((ctx) =>
      ctx.db.query("puzzleComments").collect(),
    );
    expect(stored).toHaveLength(1);
    expect(stored[0].puzzleId).toBe(puzzleId);
    expect(stored[0].copyId).toBe(aliceCopy);
    expect(stored[0].rating).toBe(5);
    expect(stored[0].aggregateId).toBeDefined();

    const list = await asAlice(t).query(
      api.social.listPuzzleComments.listPuzzleComments,
      { copyId: aliceCopy },
    );
    expect(list).toHaveLength(1);
    expect(list[0].text).toBe("Beautiful cut");
    expect(list[0].rating).toBe(5);
    // Real author identity — never anonymised.
    expect(list[0].author._id).toBe(alice as string);
    expect(list[0].author.name).toBe("Alice");
  });

  test("posts a comment without a rating; list surfaces rating null", async () => {
    const t = convexTest(schema, modules);
    const { aliceCopy } = await seed(t);

    await asAlice(t).mutation(api.social.postPuzzleComment.postPuzzleComment, {
      copyId: aliceCopy,
      text: "No stars from me",
    });

    const list = await asAlice(t).query(
      api.social.listPuzzleComments.listPuzzleComments,
      { copyId: aliceCopy },
    );
    expect(list).toHaveLength(1);
    expect(list[0].rating).toBeNull();
  });

  test("comments are scoped to each copy (two copies of the same puzzle do NOT share)", async () => {
    const t = convexTest(schema, modules);
    const { aliceCopy, bobCopy } = await seed(t);

    // Alice comments on her copy; Bob comments on his copy of the SAME puzzle.
    await asAlice(t).mutation(api.social.postPuzzleComment.postPuzzleComment, {
      copyId: aliceCopy,
      text: "from alice",
      rating: 4,
    });
    await asBob(t).mutation(api.social.postPuzzleComment.postPuzzleComment, {
      copyId: bobCopy,
      text: "from bob",
    });

    // Each copy sees ONLY its own comment.
    const viaAlice = await asAlice(t).query(
      api.social.listPuzzleComments.listPuzzleComments,
      { copyId: aliceCopy },
    );
    const viaBob = await asBob(t).query(
      api.social.listPuzzleComments.listPuzzleComments,
      { copyId: bobCopy },
    );
    expect(viaAlice.map((c) => c.text)).toEqual(["from alice"]);
    expect(viaBob.map((c) => c.text)).toEqual(["from bob"]);
  });

  test("copy-scoped comments do NOT appear in the puzzle's community reviews", async () => {
    const t = convexTest(schema, modules);
    const { puzzleId, aliceCopy } = await seed(t);

    // A copy-scoped comment with a rating.
    await asAlice(t).mutation(api.social.postPuzzleComment.postPuzzleComment, {
      copyId: aliceCopy,
      text: "my copy is mint",
      rating: 5,
    });
    // A genuine community review on the same puzzle definition.
    await asBob(t).mutation(api.social.postPuzzleReview.postPuzzleReview, {
      puzzleId,
      text: "great design",
      rating: 3,
    });

    // The catalog reviews list shows ONLY the community review, not the copy comment.
    const reviews = await asBob(t).query(
      api.social.listPuzzleReviews.listPuzzleReviews,
      { puzzleId },
    );
    expect(reviews.map((r) => r.text)).toEqual(["great design"]);
  });

  test("comments are returned newest-first", async () => {
    const t = convexTest(schema, modules);
    const { aliceCopy } = await seed(t);

    await asAlice(t).mutation(api.social.postPuzzleComment.postPuzzleComment, {
      copyId: aliceCopy,
      text: "first",
    });
    await asAlice(t).mutation(api.social.postPuzzleComment.postPuzzleComment, {
      copyId: aliceCopy,
      text: "second",
    });

    const list = await asAlice(t).query(
      api.social.listPuzzleComments.listPuzzleComments,
      { copyId: aliceCopy },
    );
    expect(list.map((c) => c.text)).toEqual(["second", "first"]);
  });

  test("empty / whitespace-only text is rejected", async () => {
    const t = convexTest(schema, modules);
    const { aliceCopy } = await seed(t);

    await expect(
      asAlice(t).mutation(api.social.postPuzzleComment.postPuzzleComment, {
        copyId: aliceCopy,
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
    const { aliceCopy } = await seed(t);

    await expect(
      asAlice(t).mutation(api.social.postPuzzleComment.postPuzzleComment, {
        copyId: aliceCopy,
        text: "ok",
        rating: 6,
      }),
    ).rejects.toThrow(ConvexError);
  });

  test("a non-owner posting on someone else's copy is rejected", async () => {
    const t = convexTest(schema, modules);
    const { aliceCopy } = await seed(t);

    // Bob is authenticated but does NOT own aliceCopy.
    await expect(
      asBob(t).mutation(api.social.postPuzzleComment.postPuzzleComment, {
        copyId: aliceCopy,
        text: "not my copy",
        rating: 5,
      }),
    ).rejects.toThrow(ConvexError);

    const stored = await t.run((ctx) =>
      ctx.db.query("puzzleComments").collect(),
    );
    expect(stored).toHaveLength(0);
  });

  test("auth is required to post a comment", async () => {
    const t = convexTest(schema, modules);
    const { aliceCopy } = await seed(t);

    await expect(
      t.mutation(api.social.postPuzzleComment.postPuzzleComment, {
        copyId: aliceCopy,
        text: "anon",
      }),
    ).rejects.toThrow(ConvexError);
  });
});
