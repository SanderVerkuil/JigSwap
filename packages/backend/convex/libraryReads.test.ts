import { convexTest } from "convex-test";
import { ConvexError } from "convex/values";
import { describe, expect, test } from "vitest";
import { api } from "./_generated/api";
import schema from "./schema";

// Bundle every Convex module for the in-memory runtime, excluding test files.
const modules = import.meta.glob(["./**/*.{js,ts}", "!./**/*.test.{js,ts}"]);

const asAlice = (t: ReturnType<typeof convexTest>) =>
  t.withIdentity({ subject: "clerk_alice" });

// Seed Alice with two copies (one available, one not), a collection containing the available copy,
// an image and a finished completion for it.
const seed = async (t: ReturnType<typeof convexTest>) =>
  t.run(async (ctx) => {
    const now = Date.now();
    const alice = await ctx.db.insert("users", {
      clerkId: "clerk_alice",
      email: "alice@example.com",
      name: "Alice",
      username: "alice",
      isActive: true,
      createdAt: now,
      updatedAt: now,
    });

    const puzzleA = await ctx.db.insert("puzzles", {
      aggregateId: "def-a",
      title: "Mountain Vista",
      brand: "Ravensburger",
      pieceCount: 1000,
      difficulty: "hard",
      status: "approved",
      submittedBy: alice,
      createdAt: now,
      updatedAt: now,
    });
    const puzzleB = await ctx.db.insert("puzzles", {
      aggregateId: "def-b",
      title: "Ocean Calm",
      brand: "Clementoni",
      pieceCount: 500,
      status: "approved",
      submittedBy: alice,
      createdAt: now,
      updatedAt: now,
    });

    const available = await ctx.db.insert("ownedPuzzles", {
      aggregateId: "copy-a",
      puzzleId: puzzleA,
      ownerId: alice,
      condition: "good",
      availability: { forTrade: true, forSale: false, forLend: false },
      createdAt: now + 1,
      updatedAt: now,
    });
    const unavailable = await ctx.db.insert("ownedPuzzles", {
      aggregateId: "copy-b",
      puzzleId: puzzleB,
      ownerId: alice,
      condition: "like_new",
      availability: { forTrade: false, forSale: false, forLend: false },
      createdAt: now,
      updatedAt: now,
    });

    const collection = await ctx.db.insert("collections", {
      aggregateId: "coll-a",
      userId: alice,
      name: "Favourites",
      visibility: "private",
      isDefault: true,
      createdAt: now,
      updatedAt: now,
    });
    // A SECOND collection for Alice so the by_user lookup is genuinely non-unique — guards against a
    // regression to `.unique()` on `by_user`, which would throw for any member with >=2 collections.
    await ctx.db.insert("collections", {
      aggregateId: "coll-a2",
      userId: alice,
      name: "Wishlist",
      visibility: "public",
      isDefault: false,
      createdAt: now,
      updatedAt: now,
    });
    await ctx.db.insert("collectionMembers", {
      collectionId: collection,
      ownedPuzzleId: available,
      addedAt: now,
    });

    const storageId = await ctx.storage.store(
      new Blob(["img"], { type: "image/png" }),
    );
    const fileId = await ctx.db.insert("ownedPuzzleImages", {
      ownedPuzzleId: available,
      uploaderId: alice,
      fileId: storageId,
      createdAt: now,
      updatedAt: now,
    });

    await ctx.db.insert("completions", {
      userId: alice,
      ownedPuzzleId: available,
      startDate: now,
      endDate: now + 1000,
      photos: [],
      isCompleted: true,
      createdAt: now,
      updatedAt: now,
    });

    return { alice, available, unavailable, collection, fileId };
  });

describe("library reads", () => {
  test("getOwnedPuzzlesByOwner joins the puzzle and honours availability + ordering", async () => {
    const t = convexTest(schema, modules);
    const { alice } = await seed(t);

    const available = await asAlice(t).query(
      api.library.getOwnedPuzzlesByOwner.getOwnedPuzzlesByOwner,
      { ownerId: alice, includeUnavailable: false },
    );
    expect(available).toHaveLength(1);
    expect(available[0].puzzle?.title).toBe("Mountain Vista");
    // Box-art is never joined onto the copy's puzzle snapshot (preserved behaviour).
    expect(available[0].puzzle?.images).toBeUndefined();

    const all = await asAlice(t).query(
      api.library.getOwnedPuzzlesByOwner.getOwnedPuzzlesByOwner,
      { ownerId: alice, includeUnavailable: true },
    );
    expect(all).toHaveLength(2);
    // Newest-first.
    expect(all[0].puzzle?.title).toBe("Mountain Vista");
  });

  test("getOwnedPuzzlesByOwner is auth-gated", async () => {
    const t = convexTest(schema, modules);
    const { alice } = await seed(t);
    await expect(
      t.query(api.library.getOwnedPuzzlesByOwner.getOwnedPuzzlesByOwner, {
        ownerId: alice,
      }),
    ).rejects.toBeInstanceOf(ConvexError);
  });

  test("getOwnedPuzzlesByOwner gates a non-owner: only available, non-private copies and owner-only fields stripped", async () => {
    const t = convexTest(schema, modules);
    const { alice, available, unavailable } = await seed(t);

    // Give the AVAILABLE copy owner-only data + a public visibility, and make the UNAVAILABLE one
    // private so a non-owner must never see it (even with includeUnavailable).
    await t.run(async (ctx) => {
      await ctx.db.patch(available, {
        visibility: "visible",
        notes: "my secret notes",
        salePrice: { amount: 1000, currency: "EUR" },
        acquisitionPrice: { amount: 500, currency: "EUR" },
        acquisitionSource: "bought_new",
      });
      await ctx.db.patch(unavailable, { visibility: "private" });
      // A fresh non-owner viewer.
      const now = Date.now();
      await ctx.db.insert("users", {
        clerkId: "clerk_bob",
        email: "bob@example.com",
        name: "Bob",
        username: "bob",
        isActive: true,
        createdAt: now,
        updatedAt: now,
      });
    });

    const asBob = t.withIdentity({ subject: "clerk_bob" });

    // Even asking for everything, the non-owner only gets the one available, non-private copy.
    const view = await asBob.query(
      api.library.getOwnedPuzzlesByOwner.getOwnedPuzzlesByOwner,
      { ownerId: alice, includeUnavailable: true },
    );
    expect(view).toHaveLength(1);
    const copy = view[0];
    expect(copy.puzzle?.title).toBe("Mountain Vista");
    // Owner-only fields (private notes + acquisition provenance) are stripped for a non-owner.
    expect(copy.notes).toBeUndefined();
    expect(copy.acquisitionPrice).toBeUndefined();
    expect(copy.acquisitionSource).toBeUndefined();
    // salePrice is the public asking price for a copy listed for sale — it stays visible.
    expect(copy.salePrice).toEqual({ amount: 1000, currency: "EUR" });
    // Adversarial: the secret notes value never appears anywhere in the payload.
    expect(JSON.stringify(view)).not.toContain("my secret notes");

    // The OWNER, by contrast, sees everything including the private copy and the owner-only fields.
    const ownerView = await asAlice(t).query(
      api.library.getOwnedPuzzlesByOwner.getOwnedPuzzlesByOwner,
      { ownerId: alice, includeUnavailable: true },
    );
    expect(ownerView).toHaveLength(2);
    const ownerCopy = ownerView.find((c) => c._id === (available as string));
    expect(ownerCopy?.notes).toBe("my secret notes");
    expect(ownerCopy?.salePrice).toEqual({ amount: 1000, currency: "EUR" });
  });

  test("browseOwnedPuzzles is auth-gated and returns a typed paginated view with owner", async () => {
    const t = convexTest(schema, modules);
    await seed(t);

    await expect(
      t.query(api.library.browseOwnedPuzzles.browseOwnedPuzzles, {}),
    ).rejects.toBeInstanceOf(ConvexError);

    // Browse shows OTHER members' copies; pass includeOwnPuzzles so Alice sees her own here.
    const result = await asAlice(t).query(
      api.library.browseOwnedPuzzles.browseOwnedPuzzles,
      { searchTerm: "mountain", includeOwnPuzzles: true },
    );
    expect(result.total).toBe(1);
    expect(result.hasMore).toBe(false);
    expect(result.ownedPuzzles[0].owner?.name).toBe("Alice");
    expect(result.ownedPuzzles[0].puzzle?.title).toBe("Mountain Vista");
  });

  test("getOwnedPuzzleWithCollectionStatus enriches images, owner, status and history", async () => {
    const t = convexTest(schema, modules);
    const { available } = await seed(t);

    const nullForAnon = await t.query(
      api.library.getOwnedPuzzleWithCollectionStatus
        .getOwnedPuzzleWithCollectionStatus,
      { ownedPuzzleId: available },
    );
    expect(nullForAnon).toBeNull();

    const view = await asAlice(t).query(
      api.library.getOwnedPuzzleWithCollectionStatus
        .getOwnedPuzzleWithCollectionStatus,
      { ownedPuzzleId: available },
    );
    expect(view).not.toBeNull();
    expect(view?.puzzle.title).toBe("Mountain Vista");
    expect(view?.images).toHaveLength(1);
    // Consumers read images[0].fileId directly.
    expect(view?.images[0].fileId).toBeDefined();
    expect(view?.owner?.name).toBe("Alice");
    // The copy IS a member of Alice's "Favourites" collection -> in-collection with its visibility.
    expect(view?.collectionStatus.isInCollection).toBe(true);
    if (view?.collectionStatus.isInCollection) {
      expect(view.collectionStatus.visibility).toBe("private");
    }
    expect(view?.completionHistory).toHaveLength(1);
  });

  test("getOwnedPuzzleWithCollectionStatus is gated to the copy owner", async () => {
    const t = convexTest(schema, modules);
    const { available } = await seed(t);

    // Bob is authenticated but does NOT own the copy: the owner-only management view (financials,
    // private notes, unmoderated photos) must not leak — he gets null.
    const bobClerk = "clerk_bob";
    await t.run(async (ctx) => {
      const now = Date.now();
      await ctx.db.insert("users", {
        clerkId: bobClerk,
        email: "bob@example.com",
        name: "Bob",
        username: "bob",
        isActive: true,
        createdAt: now,
        updatedAt: now,
      });
    });

    const seenByBob = await t
      .withIdentity({ subject: bobClerk })
      .query(
        api.library.getOwnedPuzzleWithCollectionStatus
          .getOwnedPuzzleWithCollectionStatus,
        { ownedPuzzleId: available },
      );
    expect(seenByBob).toBeNull();
  });

  test("getOwnedPuzzleWithCollectionStatus reports not-in-collection for an uncollected copy", async () => {
    const t = convexTest(schema, modules);
    const { unavailable } = await seed(t);

    // `unavailable` (copy-b) is in NONE of Alice's collections; despite Alice owning >=2 collections
    // (which would break a `.unique()` on by_user), status must be exactly { isInCollection: false }.
    const view = await asAlice(t).query(
      api.library.getOwnedPuzzleWithCollectionStatus
        .getOwnedPuzzleWithCollectionStatus,
      { ownedPuzzleId: unavailable },
    );
    expect(view).not.toBeNull();
    expect(view?.collectionStatus.isInCollection).toBe(false);
  });
});

describe("collection reads", () => {
  test("getUserCollections returns collections with derived counts, default-first", async () => {
    const t = convexTest(schema, modules);
    const { alice } = await seed(t);

    await expect(
      t.query(api.library.getUserCollections.getUserCollections, {}),
    ).rejects.toBeInstanceOf(ConvexError);

    const collections = await asAlice(t).query(
      api.library.getUserCollections.getUserCollections,
      { userId: alice },
    );
    expect(collections).toHaveLength(2);
    // Default ("Favourites") sorts first; the second collection ("Wishlist") follows.
    expect(collections[0].name).toBe("Favourites");
    expect(collections[0].puzzleCount).toBe(1);
    expect(collections[0].isDefault).toBe(true);
    expect(collections[1].name).toBe("Wishlist");
    expect(collections[1].isDefault).toBe(false);
  });

  test("getUserCollections hides another member's private collections", async () => {
    const t = convexTest(schema, modules);
    const { alice } = await seed(t);

    // A second member who only follows Alice — querying Alice's collections must surface ONLY her
    // public "Wishlist", never her private "Favourites" (names/notes must not leak).
    const bobClerk = "clerk_bob";
    await t.run(async (ctx) => {
      const now = Date.now();
      await ctx.db.insert("users", {
        clerkId: bobClerk,
        email: "bob@example.com",
        name: "Bob",
        username: "bob",
        isActive: true,
        createdAt: now,
        updatedAt: now,
      });
    });

    const asBob = t.withIdentity({ subject: bobClerk });
    const seenByBob = await asBob.query(
      api.library.getUserCollections.getUserCollections,
      { userId: alice },
    );
    expect(seenByBob.map((c) => c.name)).toEqual(["Wishlist"]);

    // The owner still sees ALL of their own collections, private included.
    const seenByAlice = await asAlice(t).query(
      api.library.getUserCollections.getUserCollections,
      { userId: alice },
    );
    expect(seenByAlice.map((c) => c.name)).toEqual(["Favourites", "Wishlist"]);
  });

  test("getUserCollections de-duplicates the target's public collections under includePublic", async () => {
    const t = convexTest(schema, modules);
    const { alice } = await seed(t);

    // A non-owner viewer querying Alice's collections WITH includePublic. Alice's public "Wishlist"
    // is fetched once as the target's public collection AND again as part of the platform-wide
    // public set — the result must contain each `_id` exactly once (no duplicate rows).
    const bobClerk = "clerk_bob";
    await t.run(async (ctx) => {
      const now = Date.now();
      await ctx.db.insert("users", {
        clerkId: bobClerk,
        email: "bob@example.com",
        name: "Bob",
        username: "bob",
        isActive: true,
        createdAt: now,
        updatedAt: now,
      });
    });

    const seenByBob = await t
      .withIdentity({ subject: bobClerk })
      .query(api.library.getUserCollections.getUserCollections, {
        userId: alice,
        includePublic: true,
      });

    const ids = seenByBob.map((c) => c._id);
    expect(ids.length).toBe(new Set(ids).size);
    // Alice's public "Wishlist" appears exactly once.
    expect(seenByBob.filter((c) => c.name === "Wishlist")).toHaveLength(1);
  });

  test("getUserCollections withholds personalNotes from a non-owner on a public collection", async () => {
    const t = convexTest(schema, modules);
    const { alice } = await seed(t);

    // Give Alice's PUBLIC "Wishlist" a private personalNotes; a non-owner must never receive it.
    await t.run(async (ctx) => {
      const wishlist = await ctx.db
        .query("collections")
        .withIndex("by_user", (q) => q.eq("userId", alice))
        .collect();
      const pub = wishlist.find((c) => c.name === "Wishlist");
      if (pub) await ctx.db.patch(pub._id, { personalNotes: "secret note" });
      const now = Date.now();
      await ctx.db.insert("users", {
        clerkId: "clerk_bob",
        email: "bob@example.com",
        name: "Bob",
        username: "bob",
        isActive: true,
        createdAt: now,
        updatedAt: now,
      });
    });

    const seenByBob = await t
      .withIdentity({ subject: "clerk_bob" })
      .query(api.library.getUserCollections.getUserCollections, {
        userId: alice,
      });
    const bobWishlist = seenByBob.find((c) => c.name === "Wishlist");
    expect(bobWishlist).toBeDefined();
    expect(bobWishlist?.personalNotes).toBeUndefined();
    expect(JSON.stringify(seenByBob)).not.toContain("secret note");

    // The owner still sees their own personalNotes.
    const seenByAlice = await asAlice(t).query(
      api.library.getUserCollections.getUserCollections,
      { userId: alice },
    );
    expect(seenByAlice.find((c) => c.name === "Wishlist")?.personalNotes).toBe(
      "secret note",
    );
  });

  test("getCollectionById withholds personalNotes from a non-owner on a public collection", async () => {
    const t = convexTest(schema, modules);
    const { alice } = await seed(t);

    const wishlistId = await t.run(async (ctx) => {
      const cols = await ctx.db
        .query("collections")
        .withIndex("by_user", (q) => q.eq("userId", alice))
        .collect();
      const pub = cols.find((c) => c.name === "Wishlist")!;
      await ctx.db.patch(pub._id, { personalNotes: "secret note" });
      const now = Date.now();
      await ctx.db.insert("users", {
        clerkId: "clerk_bob",
        email: "bob@example.com",
        name: "Bob",
        username: "bob",
        isActive: true,
        createdAt: now,
        updatedAt: now,
      });
      return pub._id;
    });

    const seenByBob = await t
      .withIdentity({ subject: "clerk_bob" })
      .query(api.library.getCollectionById.getCollectionById, {
        collectionId: wishlistId,
      });
    expect(seenByBob).not.toBeNull();
    expect(seenByBob?.personalNotes).toBeUndefined();
    expect(JSON.stringify(seenByBob)).not.toContain("secret note");

    const seenByAlice = await asAlice(t).query(
      api.library.getCollectionById.getCollectionById,
      { collectionId: wishlistId },
    );
    expect(seenByAlice?.personalNotes).toBe("secret note");
  });

  test("getCollectionById resolves member copies with addedAt", async () => {
    const t = convexTest(schema, modules);
    const { collection } = await seed(t);

    const view = await asAlice(t).query(
      api.library.getCollectionById.getCollectionById,
      { collectionId: collection },
    );
    expect(view).not.toBeNull();
    expect(view?.puzzles).toHaveLength(1);
    expect(view?.puzzles[0].puzzle?.title).toBe("Mountain Vista");
    expect(view?.puzzles[0].addedAt).toBeDefined();
  });

  test("getCollectionById strips owner-only copy fields for a non-owner viewing a public collection", async () => {
    const t = convexTest(schema, modules);
    const { alice, available } = await seed(t);

    // Make the available copy carry owner-only data, then put it in a PUBLIC collection a non-owner
    // can read. The collection is readable, but the copy's owner-only fields must not leak.
    const publicCollection = await t.run(async (ctx) => {
      const now = Date.now();
      await ctx.db.patch(available, {
        notes: "my secret notes",
        acquisitionPrice: { amount: 500, currency: "EUR" },
        acquisitionSource: "bought_new",
        salePrice: { amount: 1000, currency: "EUR" },
      });
      const coll = await ctx.db.insert("collections", {
        aggregateId: "coll-public",
        userId: alice,
        name: "Public Showcase",
        visibility: "public",
        isDefault: false,
        createdAt: now,
        updatedAt: now,
      });
      await ctx.db.insert("collectionMembers", {
        collectionId: coll,
        ownedPuzzleId: available,
        addedAt: now,
      });
      await ctx.db.insert("users", {
        clerkId: "clerk_bob",
        email: "bob@example.com",
        name: "Bob",
        username: "bob",
        isActive: true,
        createdAt: now,
        updatedAt: now,
      });
      return coll;
    });

    const seenByBob = await t
      .withIdentity({ subject: "clerk_bob" })
      .query(api.library.getCollectionById.getCollectionById, {
        collectionId: publicCollection,
      });
    expect(seenByBob).not.toBeNull();
    const bobCopy = seenByBob?.puzzles[0];
    expect(bobCopy?.notes).toBeUndefined();
    expect(bobCopy?.acquisitionPrice).toBeUndefined();
    expect(bobCopy?.acquisitionSource).toBeUndefined();
    // salePrice (public asking price) is still visible.
    expect(bobCopy?.salePrice).toEqual({ amount: 1000, currency: "EUR" });
    expect(JSON.stringify(seenByBob)).not.toContain("my secret notes");

    // The owner sees the owner-only fields.
    const seenByAlice = await asAlice(t).query(
      api.library.getCollectionById.getCollectionById,
      { collectionId: publicCollection },
    );
    const aliceCopy = seenByAlice?.puzzles[0];
    expect(aliceCopy?.notes).toBe("my secret notes");
    expect(aliceCopy?.acquisitionPrice).toEqual({
      amount: 500,
      currency: "EUR",
    });
  });

  test("getCollectionsForOwnedPuzzle returns the member's collections containing the copy", async () => {
    const t = convexTest(schema, modules);
    const { available, collection } = await seed(t);

    const collections = await asAlice(t).query(
      api.library.getCollectionsForOwnedPuzzle.getCollectionsForOwnedPuzzle,
      { ownedPuzzleId: available },
    );
    expect(collections.map((c) => c._id)).toEqual([collection]);
  });
});
