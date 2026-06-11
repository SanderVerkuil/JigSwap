import { convexTest } from "convex-test";
import { describe, expect, test } from "vitest";
import { api } from "./_generated/api";
import type { Id } from "./_generated/dataModel";
import schema from "./schema";

// Bundle every Convex module for the in-memory runtime, excluding test files.
const modules = import.meta.glob("./**/!(*.test).*s");

type Avail = { forTrade: boolean; forSale: boolean; forLend: boolean };
const FOR_SALE: Avail = { forTrade: false, forSale: true, forLend: false };

const asAlice = (t: ReturnType<typeof convexTest>) =>
  t.withIdentity({ subject: "clerk_alice" });
const asBob = (t: ReturnType<typeof convexTest>) =>
  t.withIdentity({ subject: "clerk_bob" });
const asCarol = (t: ReturnType<typeof convexTest>) =>
  t.withIdentity({ subject: "clerk_carol" });

// The custody projection is folded by an async subscriber scheduled via runAfter(0); yield then
// drain, looping to settle the chain (mirrors the exchange suite's flushScheduled).
const flushScheduled = async (t: ReturnType<typeof convexTest>) => {
  for (let i = 0; i < 10; i++) {
    await new Promise((resolve) => setTimeout(resolve, 0));
    await t.finishInProgressScheduledFunctions();
  }
};

// Seed three members and a shared puzzle; return their ids.
const seed = (t: ReturnType<typeof convexTest>) =>
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
    const owner = await mkUser("clerk_owner");
    const alice = await mkUser("clerk_alice");
    const bob = await mkUser("clerk_bob");
    const carol = await mkUser("clerk_carol");
    const puzzleId = await ctx.db.insert("puzzles", {
      title: "Test Puzzle",
      pieceCount: 1000,
      status: "approved",
      submittedBy: owner,
      createdAt: now,
      updatedAt: now,
    });
    // One copy held by `owner`; both exchanges below transfer THIS copy. aggregateId marks it a
    // domain-written copy so the Library transfer subscriber can move it through the Copy aggregate.
    const copy = await ctx.db.insert("ownedPuzzles", {
      aggregateId: "copy-agg-1",
      puzzleId,
      ownerId: owner,
      condition: "good",
      availability: FOR_SALE,
      createdAt: now,
      updatedAt: now,
    });
    return { owner, alice, bob, carol, copy };
  });

// Re-open the copy for sale so a second exchange can be proposed against it (settlement flips it
// all-false). A test-only fixup; the projection only cares that another transfer is recorded.
const reopenForSale = (
  t: ReturnType<typeof convexTest>,
  copy: Id<"ownedPuzzles">,
) => t.run(async (ctx) => ctx.db.patch(copy, { availability: FOR_SALE }));

// Drive a full sale of `copy` from `owner` to `buyerAuth`, settling it (both parties confirm).
const settleSaleToAlice = async (
  t: ReturnType<typeof convexTest>,
  copy: Id<"ownedPuzzles">,
  owner: Id<"users">,
) => {
  const id = await asAlice(t).mutation(api.exchange.propose.propose, {
    recipientId: owner,
    type: "sale",
    requestedPuzzleId: copy,
    salePrice: 1000,
  });
  await t
    .withIdentity({ subject: "clerk_owner" })
    .mutation(api.exchange.accept.accept, { exchangeId: id });
  await asAlice(t).mutation(api.exchange.confirmCompletion.confirmCompletion, {
    exchangeId: id,
  });
  await t
    .withIdentity({ subject: "clerk_owner" })
    .mutation(api.exchange.confirmCompletion.confirmCompletion, {
      exchangeId: id,
    });
  return id;
};

// Drive a full loan of `copy` from `owner` to Alice. The copy must be lendable for the proposal.
const settleLoanToAlice = async (
  t: ReturnType<typeof convexTest>,
  copy: Id<"ownedPuzzles">,
  owner: Id<"users">,
) => {
  await t.run(async (ctx) =>
    ctx.db.patch(copy, {
      availability: { forTrade: false, forSale: false, forLend: true },
    }),
  );
  const id = await asAlice(t).mutation(api.exchange.propose.propose, {
    recipientId: owner,
    type: "loan",
    requestedPuzzleId: copy,
    loanReturnDate: Date.now() + 86_400_000,
  });
  await t
    .withIdentity({ subject: "clerk_owner" })
    .mutation(api.exchange.accept.accept, { exchangeId: id });
  await asAlice(t).mutation(api.exchange.confirmCompletion.confirmCompletion, {
    exchangeId: id,
  });
  await t
    .withIdentity({ subject: "clerk_owner" })
    .mutation(api.exchange.confirmCompletion.confirmCompletion, {
      exchangeId: id,
    });
  return id;
};

const settleSaleToBob = async (
  t: ReturnType<typeof convexTest>,
  copy: Id<"ownedPuzzles">,
  owner: Id<"users">,
) => {
  const id = await asBob(t).mutation(api.exchange.propose.propose, {
    recipientId: owner,
    type: "sale",
    requestedPuzzleId: copy,
    salePrice: 1200,
  });
  await t
    .withIdentity({ subject: "clerk_owner" })
    .mutation(api.exchange.accept.accept, { exchangeId: id });
  await asBob(t).mutation(api.exchange.confirmCompletion.confirmCompletion, {
    exchangeId: id,
  });
  await t
    .withIdentity({ subject: "clerk_owner" })
    .mutation(api.exchange.confirmCompletion.confirmCompletion, {
      exchangeId: id,
    });
  return id;
};

describe("custody.getCopyCustodyTimeline", () => {
  test("returns null for a missing copy", async () => {
    const t = convexTest(schema, modules);
    const { copy } = await seed(t);
    await t.run(async (ctx) => ctx.db.delete(copy));
    const timeline = await asAlice(t).query(
      api.custody.getCopyCustodyTimeline.getCopyCustodyTimeline,
      { copyId: copy },
    );
    expect(timeline).toBeNull();
  });

  test("a never-transferred copy has the owner as both original and current owner", async () => {
    const t = convexTest(schema, modules);
    const { copy } = await seed(t);
    const timeline = await asAlice(t).query(
      api.custody.getCopyCustodyTimeline.getCopyCustodyTimeline,
      { copyId: copy },
    );
    expect(timeline).not.toBeNull();
    expect(timeline!.transfers).toEqual([]);
    expect(timeline!.originalOwner?.name).toBe("clerk_owner");
    expect(timeline!.currentOwner?.name).toBe("clerk_owner");
  });

  test("projects two settled transfers in chronological order with exchange + owner", async () => {
    const t = convexTest(schema, modules);
    const { copy, owner } = await seed(t);

    const firstExchange = await settleSaleToAlice(t, copy, owner);
    await flushScheduled(t);
    await reopenForSale(t, copy);
    const secondExchange = await settleSaleToBob(t, copy, owner);
    await flushScheduled(t);

    const timeline = await asCarol(t).query(
      api.custody.getCopyCustodyTimeline.getCopyCustodyTimeline,
      { copyId: copy },
    );

    expect(timeline).not.toBeNull();
    // Original owner is the copy creator; current owner is the LAST transfer's recipient.
    expect(timeline!.originalOwner?.name).toBe("clerk_owner");
    expect(timeline!.currentOwner?.name).toBe("clerk_bob");

    expect(timeline!.transfers).toHaveLength(2);
    expect(timeline!.transfers.map((x) => x.newOwner?.name)).toEqual([
      "clerk_alice",
      "clerk_bob",
    ]);
    expect(timeline!.transfers.map((x) => x.exchangeId)).toEqual([
      firstExchange,
      secondExchange,
    ]);
    // Ascending by time.
    expect(timeline!.transfers[0].occurredAt).toBeLessThanOrEqual(
      timeline!.transfers[1].occurredAt,
    );
  });
});

describe("ownership move on settlement", () => {
  test("a settled sale reassigns the copy to the buyer and resets it to private", async () => {
    const t = convexTest(schema, modules);
    const { copy, owner, alice } = await seed(t);

    await settleSaleToAlice(t, copy, owner);
    await flushScheduled(t);

    const row = await t.run(async (ctx) => ctx.db.get(copy));
    expect(row?.ownerId).toBe(alice); // gap closed: ownership actually moved to the buyer
    expect(row?.availability).toEqual({
      forTrade: false,
      forSale: false,
      forLend: false,
    });
  });

  test("a settled loan does not move ownership and records no custody entry", async () => {
    const t = convexTest(schema, modules);
    const { copy, owner } = await seed(t);

    await settleLoanToAlice(t, copy, owner);
    await flushScheduled(t);

    const row = await t.run(async (ctx) => ctx.db.get(copy));
    expect(row?.ownerId).toBe(owner); // a loan is possession only — ownership stays with the lender

    const timeline = await asAlice(t).query(
      api.custody.getCopyCustodyTimeline.getCopyCustodyTimeline,
      { copyId: copy },
    );
    expect(timeline!.transfers).toEqual([]);
    expect(timeline!.currentOwner?.name).toBe("clerk_owner");
  });
});
