import { convexTest, type TestConvex } from "convex-test";
import { describe, expect, test } from "vitest";
import { api } from "./_generated/api";
import type { Id } from "./_generated/dataModel";
import schema from "./schema";

// Bundle every Convex module for the in-memory runtime, excluding test files.
const modules = import.meta.glob(["./**/*.{js,ts}", "!./**/*.test.{js,ts}"]);

type T = TestConvex<typeof schema>;

const OPEN = { forTrade: false, forSale: true, forLend: true };

// The new owner's private copy fields, as sentinels a JSON scan can find anywhere in a payload.
const NOAH_NOTE = "noah-private-note-7f3a";
const NOAH_PRICE = 987654;

const as = (t: T, clerkId: string) => t.withIdentity({ subject: clerkId });
const asAlice = (t: T) => as(t, "clerk_alice"); // A: old owner
const asNoah = (t: T) => as(t, "clerk_noah"); // N: new owner

// The transfer + its follow-ups run in scheduled dispatches; yield then drain until the chain settles.
const flushScheduled = async (t: T) => {
  for (let i = 0; i < 10; i++) {
    await new Promise((resolve) => setTimeout(resolve, 0));
    await t.finishInProgressScheduledFunctions();
  }
};

// Alice is PUBLIC (so Noah can find and buy her open copy); Noah is PRIVATE and unrelated to her,
// so once he owns the copy no visibility rule lets Alice see it.
const seed = (t: T) =>
  t.run(async (ctx) => {
    const now = Date.now();
    const mkUser = (clerkId: string) =>
      ctx.db.insert("users", {
        clerkId,
        email: `${clerkId}@example.com`,
        name: clerkId,
        isActive: true,
        createdAt: now,
        updatedAt: now,
      });
    const alice = await mkUser("clerk_alice");
    const noah = await mkUser("clerk_noah");
    for (const [memberId, visibility] of [
      [alice, "public"],
      [noah, "private"],
    ] as const) {
      await ctx.db.insert("profiles", {
        memberId,
        displayName: "Member",
        visibility,
        updatedAt: now,
      });
    }
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
    return { alice, noah, puzzleAggregateId };
  });

const copyRowOf = (t: T, copyAggregateId: string) =>
  t.run(async (ctx) => {
    const row = await ctx.db
      .query("ownedPuzzles")
      .withIndex("by_aggregate_id", (q) => q.eq("aggregateId", copyAggregateId))
      .unique();
    if (!row) throw new Error("seed: copy not found");
    return row;
  });

const collectionRowIdOf = (t: T, collectionAggregateId: string) =>
  t.run(async (ctx) => {
    const row = await ctx.db
      .query("collections")
      .withIndex("by_aggregate_id", (q) =>
        q.eq("aggregateId", collectionAggregateId),
      )
      .unique();
    if (!row) throw new Error("seed: collection not found");
    return row._id;
  });

const membersOfCollection = (t: T, collectionId: Id<"collections">) =>
  t.run(async (ctx) =>
    ctx.db
      .query("collectionMembers")
      .withIndex("by_collection", (q) => q.eq("collectionId", collectionId))
      .collect(),
  );

// A member's public collection with the given copy added through the real mutation.
const collectionWith = async (
  t: T,
  who: (t: T) => ReturnType<typeof as>,
  name: string,
  copyAggregateId: string,
) => {
  const collectionAggregateId = (await who(t).mutation(
    api.library.createCollection.createCollection,
    { name, visibility: "public" },
  )) as string;
  await who(t).mutation(api.library.addCopyToCollection.addCopyToCollection, {
    collectionId: collectionAggregateId,
    copyId: copyAggregateId,
  });
  return collectionRowIdOf(t, collectionAggregateId);
};

const acquire = async (
  t: T,
  who: (t: T) => ReturnType<typeof as>,
  puzzleDefinitionId: string,
  notes: string,
) => {
  const copyAggregateId = (await who(t).mutation(
    api.library.acquireCopy.acquireCopy,
    {
      puzzleDefinitionId,
      condition: "good",
      notes,
      acquisition: {
        source: "bought_new",
        date: Date.UTC(2024, 0, 2),
        price: { amountCents: 2500, currency: "EUR" },
      },
    },
  )) as string;
  return { copyAggregateId, copy: (await copyRowOf(t, copyAggregateId))._id };
};

// Noah buys the copy from Alice through the real exchange flow; settlement transfers ownership.
const settleSaleToNoah = async (
  t: T,
  copy: Id<"ownedPuzzles">,
  alice: Id<"users">,
) => {
  const exchangeId = await asNoah(t).mutation(api.exchange.propose.propose, {
    recipientId: alice,
    type: "sale",
    requestedPuzzleId: copy,
    salePrice: 1000,
  });
  await asAlice(t).mutation(api.exchange.accept.accept, { exchangeId });
  await asNoah(t).mutation(api.exchange.confirmCompletion.confirmCompletion, {
    exchangeId,
  });
  await asAlice(t).mutation(api.exchange.confirmCompletion.confirmCompletion, {
    exchangeId,
  });
  await flushScheduled(t);
};

// Noah writes his own private fields on the copy he now owns: notes through the real update
// mutation; the acquisition price has no post-acquire mutation, so it is set on the row.
const noahSetsPrivateFields = async (
  t: T,
  copyAggregateId: string,
  copy: Id<"ownedPuzzles">,
) => {
  await asNoah(t).mutation(api.library.updateCopyDetails.updateCopyDetails, {
    copyId: copyAggregateId,
    notes: NOAH_NOTE,
  });
  await t.run(async (ctx) =>
    ctx.db.patch(copy, {
      acquisitionPrice: { amount: NOAH_PRICE, currency: "EUR" },
    }),
  );
};

// Every read that could hand Alice something about the copy, serialised for a leak scan.
const aliceReads = async (
  t: T,
  copy: Id<"ownedPuzzles">,
  collectionId: Id<"collections">,
) => {
  const collection = await asAlice(t).query(
    api.library.getCollectionById.getCollectionById,
    { collectionId },
  );
  const userCollections = await asAlice(t).query(
    api.library.getUserCollections.getUserCollections,
    {},
  );
  const containing = await asAlice(t).query(
    api.library.getCollectionsForOwnedPuzzle.getCollectionsForOwnedPuzzle,
    { ownedPuzzleId: copy },
  );
  const copyPage = await asAlice(t).query(
    api.library.getCopyInstanceView.getCopyInstanceView,
    { copyId: copy },
  );
  const managementView = await asAlice(t).query(
    api.library.getOwnedPuzzleWithCollectionStatus
      .getOwnedPuzzleWithCollectionStatus,
    { ownedPuzzleId: copy },
  );
  return {
    collection,
    userCollections,
    containing,
    copyPage,
    managementView,
    json: JSON.stringify({
      collection,
      userCollections,
      containing,
      copyPage,
      managementView,
    }),
  };
};

describe("collections on ownership transfer", () => {
  test("after a sale the old owner's collection drops the copy and no read leaks the new owner's private fields", async () => {
    const t = convexTest(schema, modules);
    const { alice, noah, puzzleAggregateId } = await seed(t);

    const { copyAggregateId, copy } = await acquire(
      t,
      asAlice,
      puzzleAggregateId,
      "alice-note",
    );
    const aliceCollection = await collectionWith(
      t,
      asAlice,
      "Alice shelf",
      copyAggregateId,
    );
    await t.run(async (ctx) => ctx.db.patch(copy, { availability: OPEN }));

    // Control: while Alice owns it, her collection lists it with her own private fields.
    const before = await asAlice(t).query(
      api.library.getCollectionById.getCollectionById,
      { collectionId: aliceCollection },
    );
    expect(before?.puzzles.map((p) => p._id)).toEqual([copy]);
    expect(before?.puzzles[0]?.notes).toBe("alice-note");

    await settleSaleToNoah(t, copy, alice);
    expect((await copyRowOf(t, copyAggregateId)).ownerId).toBe(noah);
    await noahSetsPrivateFields(t, copyAggregateId, copy);

    // The membership row is gone in the transfer's transaction.
    expect(await membersOfCollection(t, aliceCollection)).toEqual([]);

    const after = await aliceReads(t, copy, aliceCollection);
    expect(after.collection?.puzzles).toEqual([]);
    expect(
      after.userCollections.find((c) => c._id === aliceCollection)?.puzzleCount,
    ).toBe(0);
    expect(after.containing).toEqual([]);
    expect(after.managementView).toBeNull();
    expect(after.json).not.toContain(NOAH_NOTE);
    expect(after.json).not.toContain(String(NOAH_PRICE));

    // Control: Noah still sees his own private fields on the copy in his own collection.
    const noahCollection = await collectionWith(
      t,
      asNoah,
      "Noah shelf",
      copyAggregateId,
    );
    const noahView = await asNoah(t).query(
      api.library.getCollectionById.getCollectionById,
      { collectionId: noahCollection },
    );
    expect(noahView?.puzzles.map((p) => p._id)).toEqual([copy]);
    expect(noahView?.puzzles[0]?.notes).toBe(NOAH_NOTE);
    expect(noahView?.puzzles[0]?.acquisitionPrice).toEqual({
      amount: NOAH_PRICE,
      currency: "EUR",
    });
  });

  test("a stale membership row (no transfer event) never lists or leaks another member's copy", async () => {
    const t = convexTest(schema, modules);
    const { puzzleAggregateId } = await seed(t);

    // Alice's public collection holds her own copy; a legacy row also points it at Noah's copy, as a
    // transfer before this fix (or any drift) would have left behind.
    const alices = await acquire(t, asAlice, puzzleAggregateId, "alice-note");
    const aliceCollection = await collectionWith(
      t,
      asAlice,
      "Alice shelf",
      alices.copyAggregateId,
    );
    const noahs = await acquire(t, asNoah, puzzleAggregateId, NOAH_NOTE);
    await t.run(async (ctx) => {
      await ctx.db.patch(noahs.copy, {
        acquisitionPrice: { amount: NOAH_PRICE, currency: "EUR" },
      });
      await ctx.db.insert("collectionMembers", {
        collectionId: aliceCollection,
        ownedPuzzleId: noahs.copy,
        addedAt: Date.now(),
      });
    });

    const reads = await aliceReads(t, noahs.copy, aliceCollection);
    // Only Alice's own copy is listed, with her own private fields.
    expect(reads.collection?.puzzles.map((p) => p._id)).toEqual([alices.copy]);
    expect(reads.collection?.puzzles[0]?.notes).toBe("alice-note");
    expect(reads.containing).toEqual([]);
    expect(reads.json).not.toContain(noahs.copy);
    expect(reads.json).not.toContain(NOAH_NOTE);
    expect(reads.json).not.toContain(String(NOAH_PRICE));
  });
});
