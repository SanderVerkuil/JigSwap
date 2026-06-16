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

    // Verify featuredShelf returns them in order and deduped (as the owner, who sees all her copies).
    const shelf = await asAlice(t).query(
      api.social.featuredShelf.featuredShelf,
      { userId: alice },
    );
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

    const shelf = await asAlice(t).query(
      api.social.featuredShelf.featuredShelf,
      { userId: alice },
    );
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

    const shelf = await asAlice(t).query(
      api.social.featuredShelf.featuredShelf,
      { userId: alice },
    );
    expect(shelf).toEqual([]);
  });

  test("featuredShelf is auth-gated", async () => {
    const t = convexTest(schema, modules);
    const { alice } = await seedUsers(t);

    await expect(
      t.query(api.social.featuredShelf.featuredShelf, { userId: alice }),
    ).rejects.toThrow(ConvexError);
  });

  test("featuredShelf hides unreachable copies and owner-only fields from a non-owner", async () => {
    const t = convexTest(schema, modules);
    const { alice, bob } = await seedUsers(t);

    const puzzleId = await t.run((ctx) =>
      ctx.db.insert("puzzles", {
        title: "Shelf Puzzle",
        pieceCount: 500,
        status: "approved",
        submittedBy: alice,
        createdAt: Date.now(),
        updatedAt: Date.now(),
      }),
    );

    // Alice's profile is PUBLIC. An OPEN (reachable) copy with owner-only data, and a CLOSED
    // (unreachable for a non-owner) copy.
    const openCopy = await t.run((ctx) =>
      ctx.db.insert("ownedPuzzles", {
        puzzleId,
        ownerId: alice,
        condition: "good",
        availability: { forTrade: true, forSale: false, forLend: false },
        notes: "alice private notes",
        acquisitionPrice: { amount: 30, currency: "EUR" },
        acquisitionSource: "bought_new",
        createdAt: Date.now(),
        updatedAt: Date.now(),
      }),
    );
    const closedCopy = await t.run((ctx) =>
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
      copyIds: [openCopy, closedCopy],
    });

    // Bob (a non-owner) only sees the reachable OPEN copy, and never the owner-only fields.
    const seenByBob = await asBob(t).query(
      api.social.featuredShelf.featuredShelf,
      { userId: alice },
    );
    expect(seenByBob.map((c) => c._id)).toEqual([openCopy]);
    expect(seenByBob[0].notes).toBeUndefined();
    expect(seenByBob[0].acquisitionPrice).toBeUndefined();
    expect(seenByBob[0].acquisitionSource).toBeUndefined();
    expect(JSON.stringify(seenByBob)).not.toContain("alice private notes");

    // Alice (the owner) sees her full curated shelf with all owner-only fields.
    const seenByAlice = await asAlice(t).query(
      api.social.featuredShelf.featuredShelf,
      { userId: alice },
    );
    expect(seenByAlice.map((c) => c._id)).toEqual([openCopy, closedCopy]);
    expect(seenByAlice[0].notes).toBe("alice private notes");
    expect(seenByAlice[0].acquisitionPrice).toEqual({
      amount: 30,
      currency: "EUR",
    });
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
