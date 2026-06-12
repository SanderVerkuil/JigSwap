import { convexTest } from "convex-test";
import { ConvexError } from "convex/values";
import { describe, expect, test } from "vitest";
import { api } from "./_generated/api";
import type { Id } from "./_generated/dataModel";
import schema from "./schema";

// Bundle every Convex module for the in-memory runtime, excluding test files.
const modules = import.meta.glob(["./**/*.{js,ts}", "!./**/*.test.{js,ts}"]);

// Seed two members + a catalog puzzle (with aggregateId) the snapshot provider can resolve.
const seed = async (t: ReturnType<typeof convexTest>) =>
  t.run(async (ctx) => {
    const now = Date.now();
    const mkUser = (clerkId: string, email: string) =>
      ctx.db.insert("users", {
        clerkId,
        email,
        name: clerkId,
        isActive: true,
        createdAt: now,
        updatedAt: now,
      });
    const alice = await mkUser("clerk_alice", "alice@example.com");
    const bob = await mkUser("clerk_bob", "bob@example.com");
    const puzzleAggregateId = crypto.randomUUID();
    await ctx.db.insert("puzzles", {
      aggregateId: puzzleAggregateId,
      title: "Mountain Vista",
      brand: "Ravensburger",
      pieceCount: 1000,
      searchableText: "Mountain Vista Ravensburger",
      status: "approved",
      submittedBy: alice,
      createdAt: now,
      updatedAt: now,
    });
    // A pending submission contributed by Alice (not yet approved by a moderator).
    const alicePendingAggregateId = crypto.randomUUID();
    await ctx.db.insert("puzzles", {
      aggregateId: alicePendingAggregateId,
      title: "Hidden Cove",
      brand: "Clementoni",
      pieceCount: 500,
      searchableText: "Hidden Cove Clementoni",
      status: "pending",
      submittedBy: alice,
      createdAt: now,
      updatedAt: now,
    });
    // A pending submission contributed by Bob — Alice must NOT be able to acquire it.
    const bobPendingAggregateId = crypto.randomUUID();
    await ctx.db.insert("puzzles", {
      aggregateId: bobPendingAggregateId,
      title: "Northern Lights",
      brand: "Heye",
      pieceCount: 2000,
      searchableText: "Northern Lights Heye",
      status: "pending",
      submittedBy: bob,
      createdAt: now,
      updatedAt: now,
    });
    return {
      alice,
      bob,
      puzzleAggregateId,
      alicePendingAggregateId,
      bobPendingAggregateId,
    };
  });

const asAlice = (t: ReturnType<typeof convexTest>) =>
  t.withIdentity({ subject: "clerk_alice" });
const asBob = (t: ReturnType<typeof convexTest>) =>
  t.withIdentity({ subject: "clerk_bob" });

const copyRow = (t: ReturnType<typeof convexTest>, aggregateId: string) =>
  t.run(async (ctx) =>
    ctx.db
      .query("ownedPuzzles")
      .withIndex("by_aggregate_id", (q) => q.eq("aggregateId", aggregateId))
      .unique(),
  );

const collectionRow = (t: ReturnType<typeof convexTest>, aggregateId: string) =>
  t.run(async (ctx) =>
    ctx.db
      .query("collections")
      .withIndex("by_aggregate_id", (q) => q.eq("aggregateId", aggregateId))
      .unique(),
  );

const categoryRow = (t: ReturnType<typeof convexTest>, aggregateId: string) =>
  t.run(async (ctx) =>
    ctx.db
      .query("categories")
      .withIndex("by_aggregate_id", (q) => q.eq("aggregateId", aggregateId))
      .unique(),
  );

// convex-test serializes ConvexError.data to a JSON string at the function boundary; normalise.
const dataOf = (e: unknown): { code?: string } => {
  const data = (e as ConvexError<unknown>).data;
  return typeof data === "string"
    ? JSON.parse(data)
    : (data as { code?: string });
};

const expectConvexCode = async (p: Promise<unknown>, code: string) => {
  await expect(p).rejects.toBeInstanceOf(ConvexError);
  await p.catch((e: unknown) => {
    expect(dataOf(e).code).toBe(code);
  });
};

// Helper: Alice acquires a copy of the seeded puzzle, returning the new CopyId (aggregateId).
const acquireForAlice = async (
  t: ReturnType<typeof convexTest>,
  puzzleAggregateId: string,
) =>
  (await asAlice(t).mutation(api.library.acquireCopy.acquireCopy, {
    puzzleDefinitionId: puzzleAggregateId,
    condition: "good",
  })) as string;

describe("library.acquireCopy", () => {
  test("requires authentication", async () => {
    const t = convexTest(schema, modules);
    const { puzzleAggregateId } = await seed(t);
    await expect(
      t.mutation(api.library.acquireCopy.acquireCopy, {
        puzzleDefinitionId: puzzleAggregateId,
        condition: "good",
      }),
    ).rejects.toThrow("Unauthenticated");
  });

  test("caches the catalog snapshot and derives the owner from auth", async () => {
    const t = convexTest(schema, modules);
    const { alice, puzzleAggregateId } = await seed(t);
    const copyId = await acquireForAlice(t, puzzleAggregateId);
    expect(typeof copyId).toBe("string");

    const row = await copyRow(t, copyId);
    expect(row?.ownerId).toBe(alice); // from auth, not args
    expect(row?.puzzleDefinitionId).toBe(puzzleAggregateId);
    expect(row?.snapshot).toEqual({
      title: "Mountain Vista",
      brand: "Ravensburger",
      pieceCount: 1000,
      thumbnail: undefined,
    });
    // A freshly acquired copy is private and not offered for any exchange.
    expect(row?.visibility).toBe("private");
    expect(row?.availability).toEqual({
      forTrade: false,
      forSale: false,
      forLend: false,
    });
  });

  test("an unknown puzzle definition => PuzzleNotFound", async () => {
    const t = convexTest(schema, modules);
    await seed(t);
    await expectConvexCode(
      asAlice(t).mutation(api.library.acquireCopy.acquireCopy, {
        puzzleDefinitionId: crypto.randomUUID(),
        condition: "good",
      }),
      "PuzzleNotFound",
    );
  });

  test("a member may acquire a copy of their OWN not-yet-approved submission", async () => {
    const t = convexTest(schema, modules);
    const { alice, alicePendingAggregateId } = await seed(t);
    const copyId = (await asAlice(t).mutation(
      api.library.acquireCopy.acquireCopy,
      { puzzleDefinitionId: alicePendingAggregateId, condition: "good" },
    )) as string;

    const row = await copyRow(t, copyId);
    expect(row?.ownerId).toBe(alice);
    expect(row?.puzzleDefinitionId).toBe(alicePendingAggregateId);
    // The cached snapshot is taken from the pending definition, display-only (no moderation state).
    expect(row?.snapshot).toEqual({
      title: "Hidden Cove",
      brand: "Clementoni",
      pieceCount: 500,
      thumbnail: undefined,
    });
  });

  test("a member cannot acquire someone else's pending submission => PuzzleNotAcquirable", async () => {
    const t = convexTest(schema, modules);
    const { bobPendingAggregateId } = await seed(t);
    await expectConvexCode(
      asAlice(t).mutation(api.library.acquireCopy.acquireCopy, {
        puzzleDefinitionId: bobPendingAggregateId,
        condition: "good",
      }),
      "PuzzleNotAcquirable",
    );
  });
});

describe("catalog.listMyContributedPuzzles", () => {
  test("returns the member's own not-yet-approved submissions only", async () => {
    const t = convexTest(schema, modules);
    await seed(t);
    const mine = await asAlice(t).query(
      api.catalog.listMyContributedPuzzles.listMyContributedPuzzles,
      {},
    );
    // Alice's approved puzzle is excluded (it already shows in public search); her pending one is in.
    expect(mine.map((p) => p.title)).toEqual(["Hidden Cove"]);
    expect(mine[0]?.status).toBe("pending");
  });

  test("does not surface another member's pending submission", async () => {
    const t = convexTest(schema, modules);
    await seed(t);
    const bobs = await asBob(t).query(
      api.catalog.listMyContributedPuzzles.listMyContributedPuzzles,
      {},
    );
    expect(bobs.map((p) => p.title)).toEqual(["Northern Lights"]);
  });

  test("requires authentication", async () => {
    const t = convexTest(schema, modules);
    await seed(t);
    await expect(
      t.query(
        api.catalog.listMyContributedPuzzles.listMyContributedPuzzles,
        {},
      ),
    ).rejects.toThrow("Unauthenticated");
  });
});

describe("library.changeCopyCondition", () => {
  test("re-grades the owner's copy", async () => {
    const t = convexTest(schema, modules);
    const { puzzleAggregateId } = await seed(t);
    const copyId = await acquireForAlice(t, puzzleAggregateId);
    await asAlice(t).mutation(
      api.library.changeCopyCondition.changeCopyCondition,
      { copyId, condition: "fair" },
    );
    expect((await copyRow(t, copyId))?.condition).toBe("fair");
  });

  test("a non-owner cannot re-grade => NotOwner", async () => {
    const t = convexTest(schema, modules);
    const { puzzleAggregateId } = await seed(t);
    const copyId = await acquireForAlice(t, puzzleAggregateId);
    await expectConvexCode(
      asBob(t).mutation(api.library.changeCopyCondition.changeCopyCondition, {
        copyId,
        condition: "poor",
      }),
      "NotOwner",
    );
  });
});

describe("library.updateCopySharing", () => {
  test("offers the copy for trade and records the visibility axis", async () => {
    const t = convexTest(schema, modules);
    const { puzzleAggregateId } = await seed(t);
    const copyId = await acquireForAlice(t, puzzleAggregateId);
    await asAlice(t).mutation(api.library.updateCopySharing.updateCopySharing, {
      copyId,
      visibility: "visible",
      forTrade: true,
    });
    const row = await copyRow(t, copyId);
    expect(row?.availability.forTrade).toBe(true);
    expect(row?.visibility).toBe("visible");
  });

  test("a sale price is persisted as minor units + currency", async () => {
    const t = convexTest(schema, modules);
    const { puzzleAggregateId } = await seed(t);
    const copyId = await acquireForAlice(t, puzzleAggregateId);
    await asAlice(t).mutation(api.library.updateCopySharing.updateCopySharing, {
      copyId,
      visibility: "visible",
      forSale: true,
      salePrice: { amountCents: 1500, currency: "EUR" },
    });
    const row = await copyRow(t, copyId);
    expect(row?.salePrice).toEqual({ amount: 1500, currency: "EUR" });
  });

  test("a copy reserved by an active exchange cannot be made available => CopyReserved", async () => {
    const t = convexTest(schema, modules);
    const { alice, bob, puzzleAggregateId } = await seed(t);
    const copyId = await acquireForAlice(t, puzzleAggregateId);
    const row = await copyRow(t, copyId);
    // Seed an active (proposed) exchange referencing the copy as the requested item.
    await t.run(async (ctx) => {
      const now = Date.now();
      await ctx.db.insert("exchanges", {
        aggregateId: crypto.randomUUID(),
        initiatorId: bob,
        recipientId: alice,
        type: "trade",
        requestedPuzzleId: row!._id as Id<"ownedPuzzles">,
        status: "proposed",
        createdAt: now,
        updatedAt: now,
      });
    });
    await expectConvexCode(
      asAlice(t).mutation(api.library.updateCopySharing.updateCopySharing, {
        copyId,
        visibility: "visible",
        forTrade: true,
      }),
      "CopyReserved",
    );
  });
});

describe("library.createCollection", () => {
  test("creates a collection and enforces (owner, name) uniqueness", async () => {
    const t = convexTest(schema, modules);
    await seed(t);
    const id = (await asAlice(t).mutation(
      api.library.createCollection.createCollection,
      { name: "Favorites" },
    )) as string;
    const row = await collectionRow(t, id);
    expect(row?.name).toBe("Favorites");
    expect(row?.visibility).toBe("private");

    await expectConvexCode(
      asAlice(t).mutation(api.library.createCollection.createCollection, {
        name: "Favorites",
      }),
      "DuplicateCollectionName",
    );
  });
});

describe("library.addCopyToCollection / removeCopyFromCollection", () => {
  const setup = async (t: ReturnType<typeof convexTest>) => {
    const { alice, bob, puzzleAggregateId } = await seed(t);
    const copyId = await acquireForAlice(t, puzzleAggregateId);
    const collectionId = (await asAlice(t).mutation(
      api.library.createCollection.createCollection,
      { name: "Favorites" },
    )) as string;
    return { alice, bob, puzzleAggregateId, copyId, collectionId };
  };

  test("adds the owner's copy, then removes it", async () => {
    const t = convexTest(schema, modules);
    const { copyId, collectionId } = await setup(t);
    await asAlice(t).mutation(
      api.library.addCopyToCollection.addCopyToCollection,
      { collectionId, copyId },
    );
    const members = await t.run(async (ctx) =>
      ctx.db.query("collectionMembers").collect(),
    );
    expect(members).toHaveLength(1);

    await asAlice(t).mutation(
      api.library.removeCopyFromCollection.removeCopyFromCollection,
      { collectionId, copyId },
    );
    const after = await t.run(async (ctx) =>
      ctx.db.query("collectionMembers").collect(),
    );
    expect(after).toHaveLength(0);
  });

  test("a copy owned by someone else is rejected => NotCopyOwner", async () => {
    const t = convexTest(schema, modules);
    const { bob, puzzleAggregateId, collectionId } = await setup(t);
    // Bob acquires his own copy; Alice (collection owner) must not be able to add it.
    const bobCopyId = (await asBob(t).mutation(
      api.library.acquireCopy.acquireCopy,
      { puzzleDefinitionId: puzzleAggregateId, condition: "good" },
    )) as string;
    void bob;
    await expectConvexCode(
      asAlice(t).mutation(api.library.addCopyToCollection.addCopyToCollection, {
        collectionId,
        copyId: bobCopyId,
      }),
      "NotCopyOwner",
    );
  });
});

describe("library.deleteCollection", () => {
  test("deletes a non-default collection", async () => {
    const t = convexTest(schema, modules);
    await seed(t);
    const id = (await asAlice(t).mutation(
      api.library.createCollection.createCollection,
      { name: "Temporary" },
    )) as string;
    await asAlice(t).mutation(api.library.deleteCollection.deleteCollection, {
      collectionId: id,
    });
    expect(await collectionRow(t, id)).toBeNull();
  });

  test("a default collection cannot be deleted => CannotDeleteDefaultCollection", async () => {
    const t = convexTest(schema, modules);
    const { alice } = await seed(t);
    // Seed a default collection directly (the create mutation never mints defaults).
    const aggregateId = crypto.randomUUID();
    await t.run(async (ctx) => {
      const now = Date.now();
      await ctx.db.insert("collections", {
        aggregateId,
        userId: alice,
        name: "All Puzzles",
        visibility: "private",
        isDefault: true,
        createdAt: now,
        updatedAt: now,
      });
    });
    await expectConvexCode(
      asAlice(t).mutation(api.library.deleteCollection.deleteCollection, {
        collectionId: aggregateId,
      }),
      "CannotDeleteDefaultCollection",
    );
  });
});

describe("library.deleteCopy", () => {
  test("deletes the owner's copy and cascades its collection memberships", async () => {
    const t = convexTest(schema, modules);
    const { puzzleAggregateId } = await seed(t);
    const copyId = await acquireForAlice(t, puzzleAggregateId);
    const collectionId = (await asAlice(t).mutation(
      api.library.createCollection.createCollection,
      { name: "Favorites" },
    )) as string;
    await asAlice(t).mutation(
      api.library.addCopyToCollection.addCopyToCollection,
      { collectionId, copyId },
    );

    await asAlice(t).mutation(api.library.deleteCopy.deleteCopy, { copyId });

    // The row is gone and the membership rows are cleaned up with it (no orphans).
    expect(await copyRow(t, copyId)).toBeNull();
    const members = await t.run(async (ctx) =>
      ctx.db.query("collectionMembers").collect(),
    );
    expect(members).toHaveLength(0);
  });

  test("a non-owner cannot delete the copy => NotOwner", async () => {
    const t = convexTest(schema, modules);
    const { puzzleAggregateId } = await seed(t);
    const copyId = await acquireForAlice(t, puzzleAggregateId);
    await expectConvexCode(
      asBob(t).mutation(api.library.deleteCopy.deleteCopy, { copyId }),
      "NotOwner",
    );
    // The copy survives a rejected delete.
    expect(await copyRow(t, copyId)).not.toBeNull();
  });

  test("a copy reserved by an active exchange cannot be deleted => CopyReserved", async () => {
    const t = convexTest(schema, modules);
    const { alice, bob, puzzleAggregateId } = await seed(t);
    const copyId = await acquireForAlice(t, puzzleAggregateId);
    const row = await copyRow(t, copyId);
    await t.run(async (ctx) => {
      const now = Date.now();
      await ctx.db.insert("exchanges", {
        aggregateId: crypto.randomUUID(),
        initiatorId: bob,
        recipientId: alice,
        type: "trade",
        requestedPuzzleId: row!._id as Id<"ownedPuzzles">,
        status: "proposed",
        createdAt: now,
        updatedAt: now,
      });
    });
    await expectConvexCode(
      asAlice(t).mutation(api.library.deleteCopy.deleteCopy, { copyId }),
      "CopyReserved",
    );
    expect(await copyRow(t, copyId)).not.toBeNull();
  });
});

describe("library.updateCollection", () => {
  test("renames the owner's collection", async () => {
    const t = convexTest(schema, modules);
    await seed(t);
    const collectionId = (await asAlice(t).mutation(
      api.library.createCollection.createCollection,
      { name: "Favorites" },
    )) as string;
    await asAlice(t).mutation(api.library.updateCollection.updateCollection, {
      collectionId,
      name: "Top Picks",
      description: "My best puzzles",
    });
    const row = await collectionRow(t, collectionId);
    expect(row?.name).toBe("Top Picks");
    expect(row?.description).toBe("My best puzzles");
  });

  test("renaming to an existing name => DuplicateCollectionName", async () => {
    const t = convexTest(schema, modules);
    await seed(t);
    await asAlice(t).mutation(api.library.createCollection.createCollection, {
      name: "Favorites",
    });
    const second = (await asAlice(t).mutation(
      api.library.createCollection.createCollection,
      { name: "Wishlist" },
    )) as string;
    await expectConvexCode(
      asAlice(t).mutation(api.library.updateCollection.updateCollection, {
        collectionId: second,
        name: "Favorites",
      }),
      "DuplicateCollectionName",
    );
  });
});

describe("library.updateCopyDetails", () => {
  test("applies notes and missing-piece count to the owner's copy", async () => {
    const t = convexTest(schema, modules);
    const { puzzleAggregateId } = await seed(t);
    const copyId = await acquireForAlice(t, puzzleAggregateId);
    await asAlice(t).mutation(api.library.updateCopyDetails.updateCopyDetails, {
      copyId,
      notes: "Two pieces nibbled by the dog",
      missingPiecesCount: 2,
    });
    const row = await copyRow(t, copyId);
    expect(row?.notes).toBe("Two pieces nibbled by the dog");
    expect(row?.missingPiecesCount).toBe(2);
  });

  test("a non-owner cannot patch the details => NotOwner", async () => {
    const t = convexTest(schema, modules);
    const { puzzleAggregateId } = await seed(t);
    const copyId = await acquireForAlice(t, puzzleAggregateId);
    await expectConvexCode(
      asBob(t).mutation(api.library.updateCopyDetails.updateCopyDetails, {
        copyId,
        notes: "hijack",
      }),
      "NotOwner",
    );
  });
});

describe("library.createPersonalCategory", () => {
  test("creates a category and enforces (owner, name) uniqueness", async () => {
    const t = convexTest(schema, modules);
    await seed(t);
    const id = (await asAlice(t).mutation(
      api.library.createPersonalCategory.createPersonalCategory,
      { name: "Hard Puzzles", color: "#ff0000" },
    )) as string;
    const row = await categoryRow(t, id);
    expect(row?.name).toBe("Hard Puzzles");
    expect(row?.color).toBe("#ff0000");

    await expectConvexCode(
      asAlice(t).mutation(
        api.library.createPersonalCategory.createPersonalCategory,
        { name: "Hard Puzzles" },
      ),
      "DuplicateCollectionName",
    );
  });
});
