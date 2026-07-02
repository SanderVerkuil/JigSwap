import { convexTest } from "convex-test";
import { describe, expect, test } from "vitest";
import { api } from "./_generated/api";
import schema from "./schema";

// Bundle every Convex module for the in-memory runtime, excluding test files.
const modules = import.meta.glob(["./**/*.{js,ts}", "!./**/*.test.{js,ts}"]);

// Two members + two approved definitions so per-member scoping is exercised.
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
    const bob = await ctx.db.insert("users", {
      clerkId: "clerk_bob",
      email: "bob@example.com",
      name: "Bob",
      isActive: true,
      createdAt: now,
      updatedAt: now,
    });

    const mountain = await ctx.db.insert("puzzles", {
      aggregateId: "def-mountain",
      title: "Mountain Vista",
      brand: "Ravensburger",
      pieceCount: 1000,
      searchableText: "mountain vista ravensburger",
      status: "approved",
      submittedBy: alice,
      createdAt: now,
      updatedAt: now,
    });
    const ocean = await ctx.db.insert("puzzles", {
      aggregateId: "def-ocean",
      title: "Ocean Waves",
      brand: "Clementoni",
      pieceCount: 500,
      searchableText: "ocean waves clementoni",
      status: "approved",
      submittedBy: alice,
      createdAt: now,
      updatedAt: now,
    });

    return { alice, bob, mountain, ocean };
  });

describe("catalog favorites", () => {
  test("toggleFavorite favorites then unfavorites, without ever duplicating rows", async () => {
    const t = convexTest(schema, modules);
    const { alice, mountain } = await seed(t);
    const asAlice = t.withIdentity({ subject: "clerk_alice" });

    const first = await asAlice.mutation(
      api.catalog.toggleFavorite.toggleFavorite,
      { puzzleId: mountain },
    );
    expect(first).toEqual({ favorited: true });

    // Exactly one row for the (user, puzzle) pair after favoriting.
    const rowsAfterFavorite = await t.run((ctx) =>
      ctx.db
        .query("favorites")
        .withIndex("by_user", (q) => q.eq("userId", alice))
        .collect(),
    );
    expect(rowsAfterFavorite).toHaveLength(1);
    expect(rowsAfterFavorite[0].puzzleId).toBe(mountain);

    const second = await asAlice.mutation(
      api.catalog.toggleFavorite.toggleFavorite,
      { puzzleId: mountain },
    );
    expect(second).toEqual({ favorited: false });

    const rowsAfterUnfavorite = await t.run((ctx) =>
      ctx.db
        .query("favorites")
        .withIndex("by_user", (q) => q.eq("userId", alice))
        .collect(),
    );
    expect(rowsAfterUnfavorite).toHaveLength(0);

    // Toggling back on after a full round-trip favorites again (state machine is consistent).
    const third = await asAlice.mutation(
      api.catalog.toggleFavorite.toggleFavorite,
      { puzzleId: mountain },
    );
    expect(third).toEqual({ favorited: true });
  });

  test("toggleFavorite unfavorite self-heals a stray duplicate row", async () => {
    const t = convexTest(schema, modules);
    const { alice, mountain } = await seed(t);

    // Simulate a historical duplicate pair.
    await t.run(async (ctx) => {
      const now = Date.now();
      await ctx.db.insert("favorites", {
        userId: alice,
        puzzleId: mountain,
        createdAt: now,
      });
      await ctx.db.insert("favorites", {
        userId: alice,
        puzzleId: mountain,
        createdAt: now,
      });
    });

    const result = await t
      .withIdentity({ subject: "clerk_alice" })
      .mutation(api.catalog.toggleFavorite.toggleFavorite, {
        puzzleId: mountain,
      });
    expect(result).toEqual({ favorited: false });

    const rows = await t.run((ctx) =>
      ctx.db
        .query("favorites")
        .withIndex("by_user", (q) => q.eq("userId", alice))
        .collect(),
    );
    expect(rows).toHaveLength(0);
  });

  test("all favorites functions reject unauthenticated callers", async () => {
    const t = convexTest(schema, modules);
    const { mountain } = await seed(t);

    await expect(
      t.mutation(api.catalog.toggleFavorite.toggleFavorite, {
        puzzleId: mountain,
      }),
    ).rejects.toThrow(/Unauthenticated/);
    await expect(
      t.query(api.catalog.myFavoritePuzzleIds.myFavoritePuzzleIds, {}),
    ).rejects.toThrow(/Unauthenticated/);
    await expect(
      t.query(api.catalog.listMyFavorites.listMyFavorites, {}),
    ).rejects.toThrow(/Unauthenticated/);
  });

  test("toggleFavorite rejects a non-existent puzzle", async () => {
    const t = convexTest(schema, modules);
    const { mountain } = await seed(t);

    // Delete the definition so the id is dangling.
    await t.run((ctx) => ctx.db.delete(mountain));

    await expect(
      t
        .withIdentity({ subject: "clerk_alice" })
        .mutation(api.catalog.toggleFavorite.toggleFavorite, {
          puzzleId: mountain,
        }),
    ).rejects.toThrow(/Puzzle not found/);
  });

  test("myFavoritePuzzleIds and listMyFavorites are scoped to the acting member", async () => {
    const t = convexTest(schema, modules);
    const { mountain, ocean } = await seed(t);
    const asAlice = t.withIdentity({ subject: "clerk_alice" });
    const asBob = t.withIdentity({ subject: "clerk_bob" });

    await asAlice.mutation(api.catalog.toggleFavorite.toggleFavorite, {
      puzzleId: mountain,
    });
    await asAlice.mutation(api.catalog.toggleFavorite.toggleFavorite, {
      puzzleId: ocean,
    });
    await asBob.mutation(api.catalog.toggleFavorite.toggleFavorite, {
      puzzleId: ocean,
    });

    const aliceIds = await asAlice.query(
      api.catalog.myFavoritePuzzleIds.myFavoritePuzzleIds,
      {},
    );
    expect(aliceIds).toHaveLength(2);
    expect(aliceIds).toEqual(expect.arrayContaining([mountain, ocean]));

    // Bob only sees his own favorite; Alice's hearts never leak.
    const bobIds = await asBob.query(
      api.catalog.myFavoritePuzzleIds.myFavoritePuzzleIds,
      {},
    );
    expect(bobIds).toEqual([ocean]);

    const bobList = await asBob.query(
      api.catalog.listMyFavorites.listMyFavorites,
      {},
    );
    expect(bobList).toHaveLength(1);
    expect(bobList[0]._id).toBe(ocean);
    expect(bobList[0].title).toBe("Ocean Waves");
    // Summary DTO contract: box-art unset resolves to null, not a storage id.
    expect(bobList[0].image).toBeNull();
  });

  test("listMyFavorites returns newest-favorite first and skips deleted definitions", async () => {
    const t = convexTest(schema, modules);
    const { mountain, ocean } = await seed(t);
    const asAlice = t.withIdentity({ subject: "clerk_alice" });

    await asAlice.mutation(api.catalog.toggleFavorite.toggleFavorite, {
      puzzleId: mountain,
    });
    await asAlice.mutation(api.catalog.toggleFavorite.toggleFavorite, {
      puzzleId: ocean,
    });

    const list = await asAlice.query(
      api.catalog.listMyFavorites.listMyFavorites,
      {},
    );
    expect(list.map((p) => p._id)).toEqual([ocean, mountain]);

    // A favorite whose definition was deleted is skipped, not a crash / null hole.
    await t.run((ctx) => ctx.db.delete(ocean));
    const afterDelete = await asAlice.query(
      api.catalog.listMyFavorites.listMyFavorites,
      {},
    );
    expect(afterDelete.map((p) => p._id)).toEqual([mountain]);
  });
});
