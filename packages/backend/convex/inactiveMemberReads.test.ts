import { convexTest, type TestConvex } from "convex-test";
import { describe, expect, test } from "vitest";
import { api } from "./_generated/api";
import type { Id } from "./_generated/dataModel";
import schema from "./schema";

// A deactivated account (a CSAM tombstone, users.deleteUser) can hold a Clerk session that is
// still valid until its token expires. Every read that resolves the caller from Clerk must treat
// such an account like a missing one, as requireMember and optionalActingMember do (SEC-53):
// the readers that answer an unknown caller with []/null/empty groups do the same for it, and
// the readers that throw for an unknown caller throw for it too. An active caller still gets
// their data.

const modules = import.meta.glob(["./**/*.{js,ts}", "!./**/*.test.{js,ts}"]);

type T = TestConvex<typeof schema>;

// Dana owns a copy that sits on her "Mountain shelf" collection, and has one exchange with Pim
// in each direction. Only her account's isActive differs between the two runs.
const seed = (t: T, isActive: boolean) =>
  t.run(async (ctx) => {
    const now = Date.now();
    const dana = await ctx.db.insert("users", {
      clerkId: "clerk_dana",
      email: "dana@example.com",
      name: "Dana",
      isActive,
      createdAt: now,
      updatedAt: now,
    });
    const pim = await ctx.db.insert("users", {
      clerkId: "clerk_pim",
      email: "pim@example.com",
      name: "Pim",
      isActive: true,
      createdAt: now,
      updatedAt: now,
    });
    const puzzleId = await ctx.db.insert("puzzles", {
      aggregateId: crypto.randomUUID(),
      title: "Mountain Vista",
      pieceCount: 1000,
      status: "approved",
      submittedBy: pim,
      createdAt: now,
      updatedAt: now,
    });
    const copyOf = (ownerId: Id<"users">) =>
      ctx.db.insert("ownedPuzzles", {
        aggregateId: crypto.randomUUID(),
        puzzleId,
        ownerId,
        condition: "good",
        availability: { forTrade: true, forSale: false, forLend: false },
        createdAt: now,
        updatedAt: now,
      });
    const danaCopy = await copyOf(dana);
    const pimCopy = await copyOf(pim);
    const collectionId = await ctx.db.insert("collections", {
      aggregateId: crypto.randomUUID(),
      userId: dana,
      name: "Mountain shelf",
      visibility: "private",
      isDefault: false,
      createdAt: now,
      updatedAt: now,
    });
    await ctx.db.insert("collectionMembers", {
      collectionId,
      ownedPuzzleId: danaCopy,
      addedAt: now,
    });
    const exchange = (
      initiatorId: Id<"users">,
      recipientId: Id<"users">,
      requestedPuzzleId: Id<"ownedPuzzles">,
    ) =>
      ctx.db.insert("exchanges", {
        aggregateId: crypto.randomUUID(),
        initiatorId,
        recipientId,
        type: "loan",
        requestedPuzzleId,
        status: "proposed",
        createdAt: now,
        updatedAt: now,
      });
    await exchange(dana, pim, pimCopy);
    await exchange(pim, dana, danaCopy);
    return { dana, danaCopy };
  });

const asDana = (t: T) => t.withIdentity({ subject: "clerk_dana" });

describe("reads that resolve the caller from Clerk", () => {
  test("an active caller gets their own data", async () => {
    const t = convexTest(schema, modules);
    const { dana, danaCopy } = await seed(t, true);
    const as = asDana(t);

    expect(
      await as.query(
        api.exchange.getExchangesByRequester.getExchangesByRequester,
        {},
      ),
    ).toHaveLength(1);
    expect(
      await as.query(api.exchange.getExchangesByOwner.getExchangesByOwner, {}),
    ).toHaveLength(1);
    expect(
      await as.query(api.exchange.getUserExchanges.getUserExchanges, {}),
    ).toHaveLength(2);
    expect(
      await as.query(
        api.library.getOwnedPuzzleWithCollectionStatus
          .getOwnedPuzzleWithCollectionStatus,
        { ownedPuzzleId: danaCopy },
      ),
    ).toMatchObject({
      _id: danaCopy,
      collectionStatus: { isInCollection: true },
    });
    expect(
      await as.query(
        api.library.getCollectionsForOwnedPuzzle.getCollectionsForOwnedPuzzle,
        { ownedPuzzleId: danaCopy },
      ),
    ).toHaveLength(1);
    expect(
      await as.query(api.library.getUserCollections.getUserCollections, {}),
    ).toHaveLength(1);
    expect(
      (await as.query(api.search.globalSearch.global, { term: "mountain" }))
        .collections,
    ).toHaveLength(1);
    expect(
      await as.query(api.identity.getCurrentUser.getCurrentUser, {}),
    ).toMatchObject({ _id: dana });
  });

  test("a deactivated caller is treated like an unknown one", async () => {
    const t = convexTest(schema, modules);
    const { danaCopy } = await seed(t, false);
    const as = asDana(t);

    expect(
      await as.query(
        api.exchange.getExchangesByRequester.getExchangesByRequester,
        {},
      ),
    ).toEqual([]);
    expect(
      await as.query(api.exchange.getExchangesByOwner.getExchangesByOwner, {}),
    ).toEqual([]);
    expect(
      await as.query(api.exchange.getUserExchanges.getUserExchanges, {}),
    ).toEqual([]);
    expect(
      await as.query(
        api.library.getOwnedPuzzleWithCollectionStatus
          .getOwnedPuzzleWithCollectionStatus,
        { ownedPuzzleId: danaCopy },
      ),
    ).toBeNull();
    await expect(
      as.query(
        api.library.getCollectionsForOwnedPuzzle.getCollectionsForOwnedPuzzle,
        { ownedPuzzleId: danaCopy },
      ),
    ).rejects.toThrow();
    await expect(
      as.query(api.library.getUserCollections.getUserCollections, {}),
    ).rejects.toThrow();
    expect(
      await as.query(api.search.globalSearch.global, { term: "mountain" }),
    ).toEqual({ puzzles: [], people: [], circles: [], collections: [] });
    expect(
      await as.query(api.identity.getCurrentUser.getCurrentUser, {}),
    ).toBeNull();
  });

  test("a signed-out caller keeps today's answers", async () => {
    const t = convexTest(schema, modules);
    const { danaCopy } = await seed(t, true);

    expect(
      await t.query(
        api.exchange.getExchangesByRequester.getExchangesByRequester,
        {},
      ),
    ).toEqual([]);
    expect(
      await t.query(api.exchange.getExchangesByOwner.getExchangesByOwner, {}),
    ).toEqual([]);
    expect(
      await t.query(api.exchange.getUserExchanges.getUserExchanges, {}),
    ).toEqual([]);
    expect(
      await t.query(
        api.library.getOwnedPuzzleWithCollectionStatus
          .getOwnedPuzzleWithCollectionStatus,
        { ownedPuzzleId: danaCopy },
      ),
    ).toBeNull();
    await expect(
      t.query(
        api.library.getCollectionsForOwnedPuzzle.getCollectionsForOwnedPuzzle,
        { ownedPuzzleId: danaCopy },
      ),
    ).rejects.toThrow();
    await expect(
      t.query(api.library.getUserCollections.getUserCollections, {}),
    ).rejects.toThrow();
    expect(
      await t.query(api.search.globalSearch.global, { term: "mountain" }),
    ).toEqual({ puzzles: [], people: [], circles: [], collections: [] });
    expect(
      await t.query(api.identity.getCurrentUser.getCurrentUser, {}),
    ).toBeNull();
  });
});
