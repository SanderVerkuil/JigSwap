import { convexTest } from "convex-test";
import { ConvexError } from "convex/values";
import { describe, expect, test } from "vitest";
import { api } from "./_generated/api";
import schema from "./schema";

// Bundle every Convex module for the in-memory runtime, excluding test files.
const modules = import.meta.glob(["./**/*.{js,ts}", "!./**/*.test.{js,ts}"]);

const seedUsers = (t: ReturnType<typeof convexTest>) =>
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
    return { alice, bob };
  });

const asAlice = (t: ReturnType<typeof convexTest>) =>
  t.withIdentity({ subject: "clerk_alice" });

const asBob = (t: ReturnType<typeof convexTest>) =>
  t.withIdentity({ subject: "clerk_bob" });

describe("arrangeShelf", () => {
  test("arranging with another user's copy is rejected", async () => {
    const t = convexTest(schema, modules);
    const { alice, bob } = await seedUsers(t);

    // Bob owns a puzzle
    const puzzleId = await t.run((ctx) =>
      ctx.db.insert("puzzles", {
        title: "Test Puzzle",
        pieceCount: 500,
        status: "approved",
        submittedBy: bob,
        createdAt: Date.now(),
        updatedAt: Date.now(),
      }),
    );
    const bobsCopyId = await t.run((ctx) =>
      ctx.db.insert("ownedPuzzles", {
        puzzleId,
        ownerId: bob,
        condition: "good",
        availability: { forTrade: false, forSale: false, forLend: false },
        createdAt: Date.now(),
        updatedAt: Date.now(),
      }),
    );

    // Alice tries to arrange a shelf with Bob's copy
    await expect(
      asAlice(t).mutation(api.social.arrangeShelf.arrangeShelf, {
        copyIds: [bobsCopyId],
      }),
    ).rejects.toThrow(ConvexError);
  });

  test("arranging with owned copies persists the deduped/capped ordered featuredCopyIds", async () => {
    const t = convexTest(schema, modules);
    const { alice } = await seedUsers(t);

    const puzzleId = await t.run((ctx) =>
      ctx.db.insert("puzzles", {
        title: "Test Puzzle",
        pieceCount: 1000,
        status: "approved",
        submittedBy: alice,
        createdAt: Date.now(),
        updatedAt: Date.now(),
      }),
    );

    const copy1 = await t.run((ctx) =>
      ctx.db.insert("ownedPuzzles", {
        puzzleId,
        ownerId: alice,
        condition: "good",
        availability: { forTrade: false, forSale: false, forLend: false },
        createdAt: Date.now(),
        updatedAt: Date.now(),
      }),
    );
    const copy2 = await t.run((ctx) =>
      ctx.db.insert("ownedPuzzles", {
        puzzleId,
        ownerId: alice,
        condition: "like_new",
        availability: { forTrade: false, forSale: false, forLend: false },
        createdAt: Date.now(),
        updatedAt: Date.now(),
      }),
    );

    // First set up Alice's profile
    await asAlice(t).mutation(api.social.editProfile.editProfile, {
      displayName: "Alice",
    });

    // Arrange shelf with [copy2, copy1, copy2] — duplicates should be deduped
    await asAlice(t).mutation(api.social.arrangeShelf.arrangeShelf, {
      copyIds: [copy2, copy1, copy2],
    });

    const profile = await asAlice(t).query(
      api.social.getProfile.getProfile,
      {},
    );
    expect(profile).not.toBeNull();

    // Verify featuredShelf returns them in order and deduped
    const shelf = await t.query(api.social.featuredShelf.featuredShelf, {
      userId: alice,
    });
    expect(shelf).toHaveLength(2);
    expect(shelf[0]._id).toBe(copy2);
    expect(shelf[1]._id).toBe(copy1);
  });

  test("featuredShelf returns items in order and drops a deleted copy", async () => {
    const t = convexTest(schema, modules);
    const { alice } = await seedUsers(t);

    const puzzleId = await t.run((ctx) =>
      ctx.db.insert("puzzles", {
        title: "Another Puzzle",
        pieceCount: 500,
        status: "approved",
        submittedBy: alice,
        createdAt: Date.now(),
        updatedAt: Date.now(),
      }),
    );

    const copy1 = await t.run((ctx) =>
      ctx.db.insert("ownedPuzzles", {
        puzzleId,
        ownerId: alice,
        condition: "good",
        availability: { forTrade: false, forSale: false, forLend: false },
        createdAt: Date.now(),
        updatedAt: Date.now(),
      }),
    );
    const copy2 = await t.run((ctx) =>
      ctx.db.insert("ownedPuzzles", {
        puzzleId,
        ownerId: alice,
        condition: "like_new",
        availability: { forTrade: false, forSale: false, forLend: false },
        createdAt: Date.now(),
        updatedAt: Date.now(),
      }),
    );

    await asAlice(t).mutation(api.social.editProfile.editProfile, {
      displayName: "Alice",
    });

    await asAlice(t).mutation(api.social.arrangeShelf.arrangeShelf, {
      copyIds: [copy1, copy2],
    });

    // Delete copy1
    await t.run((ctx) => ctx.db.delete(copy1));

    const shelf = await t.query(api.social.featuredShelf.featuredShelf, {
      userId: alice,
    });
    // copy1 was deleted, only copy2 should remain
    expect(shelf).toHaveLength(1);
    expect(shelf[0]._id).toBe(copy2);
  });

  test("featuredShelf returns [] when the profile has no curation", async () => {
    const t = convexTest(schema, modules);
    const { alice } = await seedUsers(t);

    await asAlice(t).mutation(api.social.editProfile.editProfile, {
      displayName: "Alice",
    });

    const shelf = await t.query(api.social.featuredShelf.featuredShelf, {
      userId: alice,
    });
    expect(shelf).toEqual([]);
  });

  test("arrangeShelf records a ProfileShelfArranged domain event", async () => {
    const t = convexTest(schema, modules);
    const { alice } = await seedUsers(t);

    await asAlice(t).mutation(api.social.arrangeShelf.arrangeShelf, {
      copyIds: [],
    });
    const events = await t.run((ctx) => ctx.db.query("domainEvents").collect());
    expect(events.map((e) => e.name)).toContain("ProfileShelfArranged");
  });

  test("requires authentication", async () => {
    const t = convexTest(schema, modules);
    await seedUsers(t);

    await expect(
      t.mutation(api.social.arrangeShelf.arrangeShelf, { copyIds: [] }),
    ).rejects.toThrow(ConvexError);
  });
});
