import { convexTest, type TestConvex } from "convex-test";
import { describe, expect, test } from "vitest";
import { api, internal } from "./_generated/api";
import type { Id } from "./_generated/dataModel";
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

  const block = (
    t: TestConvex<typeof schema>,
    blockerId: Id<"users">,
    blockedId: Id<"users">,
  ) =>
    t.run((ctx) =>
      ctx.db.insert("blocks", { blockerId, blockedId, createdAt: NOW }),
    );

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
