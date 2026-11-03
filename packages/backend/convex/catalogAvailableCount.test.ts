import { convexTest, type TestConvex } from "convex-test";
import { describe, expect, test } from "vitest";
import { api, internal } from "./_generated/api";
import type { Id } from "./_generated/dataModel";
import type { MutationCtx } from "./_generated/server";
import schema from "./schema";

// The catalogue card's "N available" chip links to Browse for that puzzle, so its number is what
// that Browse can show: the definition's stored public offers, minus the viewer's own and those of
// members blocked either way (Browse never lists those). Until the definition's stats exist the row
// simply has no count: a paged list never computes the aggregates live.

const modules = import.meta.glob(["./**/*.{js,ts}", "!./**/*.test.{js,ts}"]);

const NOW = 1_700_000_000_000;
const OPEN = { forTrade: true, forSale: false, forLend: false };
const CLOSED = { forTrade: false, forSale: false, forLend: false };

const seed = (t: TestConvex<typeof schema>) =>
  t.run(async (ctx) => {
    const mkUser = (clerkId: string) =>
      ctx.db.insert("users", {
        clerkId,
        email: `${clerkId}@example.com`,
        name: clerkId,
        isActive: true,
        createdAt: NOW,
        updatedAt: NOW,
      });
    const alice = await mkUser("clerk_alice");
    const bob = await mkUser("clerk_bob");
    const carol = await mkUser("clerk_carol");
    const puzzleId = await ctx.db.insert("puzzles", {
      title: "Harbour",
      pieceCount: 1000,
      status: "approved",
      submittedBy: bob,
      searchableText: "Harbour",
      createdAt: NOW,
      updatedAt: NOW,
    });
    return { alice, bob, carol, puzzleId };
  });

const addCopy = (
  t: TestConvex<typeof schema>,
  ownerId: Id<"users">,
  puzzleId: Id<"puzzles">,
  availability = OPEN,
) =>
  t.run((ctx) =>
    ctx.db.insert("ownedPuzzles", {
      puzzleId,
      ownerId,
      condition: "good",
      availability,
      createdAt: NOW,
      updatedAt: NOW,
    }),
  );

const recompute = (t: TestConvex<typeof schema>, puzzleId: Id<"puzzles">) =>
  t.mutation(internal.library.definitionStats.recompute, { puzzleId });

const availableCount = async (t: TestConvex<typeof schema>) => {
  const { page } = await t
    .withIdentity({ subject: "clerk_alice" })
    .query(api.catalog.searchCatalog.searchCatalog, {
      paginationOpts: { numItems: 10, cursor: null },
    });
  return page[0]?.availableCount;
};

const block = (
  t: TestConvex<typeof schema>,
  blockerId: Id<"users">,
  blockedId: Id<"users">,
) =>
  t.run((ctx) =>
    ctx.db.insert("blocks", { blockerId, blockedId, createdAt: NOW }),
  );

describe("catalog search: availableCount", () => {
  test("is absent until the definition's stats exist", async () => {
    const t = convexTest(schema, modules);
    const { bob, puzzleId } = await seed(t);
    await addCopy(t, bob, puzzleId);
    expect(await availableCount(t)).toBeUndefined();
  });

  test("counts other members' public offers", async () => {
    const t = convexTest(schema, modules);
    const { bob, carol, puzzleId } = await seed(t);
    await addCopy(t, bob, puzzleId);
    await addCopy(t, carol, puzzleId);
    await addCopy(t, carol, puzzleId, CLOSED);
    await recompute(t, puzzleId);
    expect(await availableCount(t)).toBe(2);
  });

  test("leaves out the viewer's own offers, as Browse does", async () => {
    const t = convexTest(schema, modules);
    const { alice, bob, puzzleId } = await seed(t);
    await addCopy(t, alice, puzzleId);
    await addCopy(t, bob, puzzleId);
    await recompute(t, puzzleId);
    expect(await availableCount(t)).toBe(1);
  });

  test("has no count when only the viewer offers it", async () => {
    const t = convexTest(schema, modules);
    const { alice, puzzleId } = await seed(t);
    await addCopy(t, alice, puzzleId);
    await recompute(t, puzzleId);
    expect(await availableCount(t)).toBeUndefined();
  });

  test("doesn't subtract a private viewer's offer, which was never counted", async () => {
    const t = convexTest(schema, modules);
    const { alice, bob, puzzleId } = await seed(t);
    await t.run((ctx) =>
      ctx.db.insert("profiles", {
        memberId: alice,
        visibility: "private",
        updatedAt: NOW,
      }),
    );
    await addCopy(t, alice, puzzleId);
    await addCopy(t, bob, puzzleId);
    await recompute(t, puzzleId);
    expect(await availableCount(t)).toBe(1);
  });

  test("leaves out the offers of a member the viewer blocked", async () => {
    const t = convexTest(schema, modules);
    const { alice, bob, carol, puzzleId } = await seed(t);
    await addCopy(t, bob, puzzleId);
    await addCopy(t, carol, puzzleId);
    await recompute(t, puzzleId);
    await block(t, alice, bob);
    expect(await availableCount(t)).toBe(1);
  });

  test("leaves out the offers of a member who blocked the viewer", async () => {
    const t = convexTest(schema, modules);
    const { alice, bob, carol, puzzleId } = await seed(t);
    await addCopy(t, bob, puzzleId);
    await addCopy(t, carol, puzzleId);
    await recompute(t, puzzleId);
    await block(t, bob, alice);
    expect(await availableCount(t)).toBe(1);
  });

  test("has no count when a blocked member is the only one offering it", async () => {
    const t = convexTest(schema, modules);
    const { alice, bob, puzzleId } = await seed(t);
    await addCopy(t, bob, puzzleId);
    await recompute(t, puzzleId);
    await block(t, bob, alice);
    expect(await availableCount(t)).toBeUndefined();
  });

  test("subtracts only a blocked member's offers that were counted", async () => {
    const t = convexTest(schema, modules);
    const { alice, bob, carol, puzzleId } = await seed(t);
    // A closed copy, and an open one of a private owner, were never in the stored count.
    await addCopy(t, bob, puzzleId, CLOSED);
    await t.run((ctx) =>
      ctx.db.insert("profiles", {
        memberId: carol,
        visibility: "private",
        updatedAt: NOW,
      }),
    );
    await addCopy(t, carol, puzzleId);
    await addCopy(t, alice, puzzleId);
    const dave = await t.run((ctx) =>
      ctx.db.insert("users", {
        clerkId: "clerk_dave",
        email: "dave@example.com",
        name: "dave",
        isActive: true,
        createdAt: NOW,
        updatedAt: NOW,
      }),
    );
    await addCopy(t, dave, puzzleId);
    await recompute(t, puzzleId);
    await block(t, alice, bob);
    await block(t, alice, carol);
    expect(await availableCount(t)).toBe(1);
  });

  test("keeps blocks one viewer's business: another viewer's count is unchanged", async () => {
    const t = convexTest(schema, modules);
    const { alice, bob, carol, puzzleId } = await seed(t);
    await addCopy(t, bob, puzzleId);
    await recompute(t, puzzleId);
    await block(t, carol, bob);
    expect(await availableCount(t)).toBe(1);
    await block(t, alice, bob);
    expect(await availableCount(t)).toBeUndefined();
  });
});

// A viewer's blocks mustn't make them read other members' copies: those rows are up to 5,000
// characters of notes each, and anyone can pile them onto the newest definitions.
describe("catalog search: what the chip reads for a viewer with blocks", () => {
  const statsOf = (swap: number) => ({
    computedAt: NOW,
    totals: {
      ratingCount: 0,
      ratingSum: 0,
      breakdown: [0, 0, 0, 0, 0],
      completedCount: 0,
      finishDaysSum: 0,
      finishDaysCount: 0,
      communityOwners: swap,
      ownerCount: swap,
      publicAvailable: { swap, lend: 0, sale: 0 },
    },
  });

  const member = (ctx: MutationCtx, clerkId: string) =>
    ctx.db.insert("users", {
      clerkId,
      email: `${clerkId}@example.com`,
      name: clerkId,
      isActive: true,
      createdAt: NOW,
      updatedAt: NOW,
    });

  test("a flood of someone else's long copies costs nothing, under Convex's real limits", async () => {
    const t = convexTest({ schema, modules, transactionLimits: true });
    const { alice, bob, carol } = await seed(t);
    await block(t, alice, carol);
    // 200 copies of each of 20 definitions, more bytes than one function may read.
    for (let d = 0; d < 20; d++) {
      await t.run(async (ctx) => {
        const puzzleId = await ctx.db.insert("puzzles", {
          title: `flooded ${d}`,
          pieceCount: 1000,
          status: "approved",
          submittedBy: bob,
          createdAt: NOW,
          updatedAt: NOW,
        });
        await ctx.db.insert("definitionStats", {
          puzzleId,
          ...statsOf(200),
        });
        for (let i = 0; i < 200; i++) {
          await ctx.db.insert("ownedPuzzles", {
            puzzleId,
            ownerId: bob,
            condition: "good",
            availability: OPEN,
            isOpen: true,
            listedAt: NOW,
            notes: "n".repeat(5000),
            createdAt: NOW,
            updatedAt: NOW,
          });
        }
      });
    }

    const { page } = await t
      .withIdentity({ subject: "clerk_alice" })
      .query(api.catalog.searchCatalog.searchCatalog, {
        paginationOpts: { numItems: 21, cursor: null },
      });

    expect(page.filter((row) => row.availableCount === 200)).toHaveLength(20);
  }, 300_000);

  test("a blocked member's offer behind a flood of others' copies still comes off", async () => {
    const t = convexTest(schema, modules);
    const { alice, bob, carol, puzzleId } = await seed(t);
    await t.run(async (ctx) => {
      for (let i = 0; i < 205; i++) {
        await ctx.db.insert("ownedPuzzles", {
          puzzleId,
          ownerId: bob,
          condition: "good",
          availability: OPEN,
          createdAt: NOW,
          updatedAt: NOW,
        });
      }
    });
    await addCopy(t, carol, puzzleId);
    await recompute(t, puzzleId);
    await block(t, alice, carol);

    expect(await availableCount(t)).toBe(205);
  });

  test("however many members blocked the viewer, under Convex's real limits, and the viewer's own blocks count first", async () => {
    const t = convexTest({ schema, modules, transactionLimits: true });
    const { alice, bob, carol, puzzleId } = await seed(t);
    await addCopy(t, carol, puzzleId);
    await addCopy(t, bob, puzzleId);
    await recompute(t, puzzleId);
    await block(t, alice, carol);
    await t.run(async (ctx) => {
      for (let i = 0; i < 300; i++) {
        await ctx.db.insert("blocks", {
          blockerId: await member(ctx, `clerk_blocker_${i}`),
          blockedId: alice,
          createdAt: NOW,
        });
      }
      // A full page of definitions.
      for (let d = 0; d < 49; d++) {
        await ctx.db.insert("definitionStats", {
          puzzleId: await ctx.db.insert("puzzles", {
            title: `other ${d}`,
            pieceCount: 1000,
            status: "approved",
            submittedBy: bob,
            createdAt: NOW,
            updatedAt: NOW,
          }),
          ...statsOf(1),
        });
      }
    });

    const { page } = await t
      .withIdentity({ subject: "clerk_alice" })
      .query(api.catalog.searchCatalog.searchCatalog, {
        paginationOpts: { numItems: 50, cursor: null },
      });

    expect(page).toHaveLength(50);
    expect(page.find((row) => row._id === puzzleId)?.availableCount).toBe(1);
  }, 120_000);
});
