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
  test("posts a plain-text comment; list returns it with the real author and NO rating", async () => {
    const t = convexTest(schema, modules);
    const { alice, puzzleId, aliceCopy } = await seed(t);

    await asAlice(t).mutation(api.social.postPuzzleComment.postPuzzleComment, {
      copyId: aliceCopy,
      text: "Beautiful cut",
    });

    // Persisted with the catalog puzzleId (for context) AND scoped to the owned copy. Comments are
    // plain text now — no rating is ever written (copy-level opinions live in copyReviews).
    const stored = await t.run((ctx) =>
      ctx.db.query("puzzleComments").collect(),
    );
    expect(stored).toHaveLength(1);
    expect(stored[0].puzzleId).toBe(puzzleId);
    expect(stored[0].copyId).toBe(aliceCopy);
    expect(stored[0].rating).toBeUndefined();
    expect(stored[0].aggregateId).toBeDefined();

    const list = await asAlice(t).query(
      api.social.listPuzzleComments.listPuzzleComments,
      { copyId: aliceCopy },
    );
    expect(list).toHaveLength(1);
    expect(list[0].text).toBe("Beautiful cut");
    // The projection carries no rating key at all — the DTO is plain text.
    expect(list[0]).not.toHaveProperty("rating");
    // Real author identity — never anonymised.
    expect(list[0].author._id).toBe(alice as string);
    expect(list[0].author.name).toBe("Alice");
  });

  test("comments are scoped to each copy (two copies of the same puzzle do NOT share)", async () => {
    const t = convexTest(schema, modules);
    const { aliceCopy, bobCopy } = await seed(t);

    // Alice comments on her copy; Bob comments on his copy of the SAME puzzle.
    await asAlice(t).mutation(api.social.postPuzzleComment.postPuzzleComment, {
      copyId: aliceCopy,
      text: "from alice",
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
    const { bob, puzzleId, aliceCopy } = await seed(t);

    // A copy-scoped comment.
    await asAlice(t).mutation(api.social.postPuzzleComment.postPuzzleComment, {
      copyId: aliceCopy,
      text: "my copy is mint",
    });
    // A genuine community review row on the same puzzle definition. Seeded directly: the review
    // FORM now upserts `puzzleReviews`, but the list still reads `puzzleComments` until it is
    // repointed in a later task.
    await t.run(async (ctx) => {
      await ctx.db.insert("puzzleComments", {
        aggregateId: crypto.randomUUID(),
        puzzleId,
        authorId: bob,
        text: "great design",
        rating: 3,
        createdAt: Date.now(),
      });
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

  test("a non-owner posting on someone else's copy is rejected", async () => {
    const t = convexTest(schema, modules);
    const { aliceCopy } = await seed(t);

    // Bob is authenticated but does NOT own aliceCopy.
    await expect(
      asBob(t).mutation(api.social.postPuzzleComment.postPuzzleComment, {
        copyId: aliceCopy,
        text: "not my copy",
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

  test("listPuzzleComments is auth-gated", async () => {
    const t = convexTest(schema, modules);
    const { aliceCopy } = await seed(t);

    await expect(
      t.query(api.social.listPuzzleComments.listPuzzleComments, {
        copyId: aliceCopy,
      }),
    ).rejects.toThrow(ConvexError);
  });

  test("listPuzzleComments hides comments on an unreachable copy from a non-owner", async () => {
    const t = convexTest(schema, modules);
    const { aliceCopy } = await seed(t);

    // Alice's copy is CLOSED (not open) and her profile defaults to public — so it is unreachable
    // for Bob, who would otherwise see her private per-copy notes.
    await asAlice(t).mutation(api.social.postPuzzleComment.postPuzzleComment, {
      copyId: aliceCopy,
      text: "my private take",
    });

    const seenByBob = await asBob(t).query(
      api.social.listPuzzleComments.listPuzzleComments,
      { copyId: aliceCopy },
    );
    expect(seenByBob).toEqual([]);

    // The owner still sees their own comments.
    const seenByAlice = await asAlice(t).query(
      api.social.listPuzzleComments.listPuzzleComments,
      { copyId: aliceCopy },
    );
    expect(seenByAlice.map((c) => c.text)).toEqual(["my private take"]);
  });

  test("listPuzzleComments returns comments on a reachable copy to a non-owner", async () => {
    const t = convexTest(schema, modules);
    const { aliceCopy } = await seed(t);

    // Make Alice's copy OPEN; her profile defaults to public, so it is reachable for Bob.
    await t.run(async (ctx) => {
      await ctx.db.patch(aliceCopy, {
        availability: { forTrade: true, forSale: false, forLend: false },
      });
    });
    await asAlice(t).mutation(api.social.postPuzzleComment.postPuzzleComment, {
      copyId: aliceCopy,
      text: "publicly reachable",
    });

    const seenByBob = await asBob(t).query(
      api.social.listPuzzleComments.listPuzzleComments,
      { copyId: aliceCopy },
    );
    expect(seenByBob.map((c) => c.text)).toEqual(["publicly reachable"]);
  });
});
