import { convexTest, type TestConvex } from "convex-test";
import { ConvexError, type Value } from "convex/values";
import { describe, expect, test } from "vitest";
import { api } from "./_generated/api";
import type { Id } from "./_generated/dataModel";
import schema from "./schema";

// SEC-02: ownership was checked only when an exchange was proposed. A copy can change hands while
// an exchange on it stays open, and a stale exchange then settled anyway, moving the copy (photos
// and history included) out of the library of an owner who was never a party to it. Accept and
// confirm-completion now refuse once a copy is no longer where the deal found it. Driven through
// the real mutations and the async settlement dispatch.

const modules = import.meta.glob(["./**/*.{js,ts}", "!./**/*.test.{js,ts}"]);

type T = TestConvex<typeof schema>;
type Name = "bob" | "sock" | "vic" | "mara" | "hugo" | "rex";
type Ids = Record<Name, Id<"users">>;
type Copy = { aggregateId: string; id: Id<"ownedPuzzles"> };

const as = (t: T, name: Name) => t.withIdentity({ subject: `clerk_${name}` });

// The transfer and loan reactions run in scheduled dispatches; yield then drain until they settle.
const flush = async (t: T) => {
  for (let i = 0; i < 12; i++) {
    await new Promise((resolve) => setTimeout(resolve, 0));
    await t.finishInProgressScheduledFunctions();
  }
};

// Everyone has a public profile (no profile row) and nobody blocks anyone.
const seed = (t: T) =>
  t.run(async (ctx) => {
    const now = Date.now();
    const mkUser = (name: Name) =>
      ctx.db.insert("users", {
        clerkId: `clerk_${name}`,
        email: `${name}@example.com`,
        name,
        isActive: true,
        createdAt: now,
        updatedAt: now,
      });
    const ids: Ids = {
      bob: await mkUser("bob"),
      sock: await mkUser("sock"),
      vic: await mkUser("vic"),
      mara: await mkUser("mara"),
      hugo: await mkUser("hugo"),
      rex: await mkUser("rex"),
    };
    const puzzleAggregateId = crypto.randomUUID();
    await ctx.db.insert("puzzles", {
      aggregateId: puzzleAggregateId,
      title: "Harbour Lights",
      pieceCount: 1000,
      status: "approved",
      submittedBy: ids.bob,
      createdAt: now,
      updatedAt: now,
    });
    return { ids, puzzleAggregateId };
  });

const acquire = async (
  t: T,
  owner: Name,
  puzzleAggregateId: string,
): Promise<Copy> => {
  const aggregateId = (await as(t, owner).mutation(
    api.library.acquireCopy.acquireCopy,
    { puzzleDefinitionId: puzzleAggregateId, condition: "good" },
  )) as string;
  const row = await t.run((ctx) =>
    ctx.db
      .query("ownedPuzzles")
      .withIndex("by_aggregate_id", (q) => q.eq("aggregateId", aggregateId))
      .unique(),
  );
  if (!row) throw new Error("seed: copy not found");
  return { aggregateId, id: row._id };
};

const offer = (
  t: T,
  owner: Name,
  copy: Copy,
  flags: { forTrade?: boolean; forSale?: boolean; forLend?: boolean },
) =>
  as(t, owner).mutation(api.library.updateCopySharing.updateCopySharing, {
    copyId: copy.aggregateId,
    visibility: "visible",
    ...flags,
  });

const proposeSale = (t: T, buyer: Name, copy: Copy) =>
  as(t, buyer).mutation(api.exchange.propose.propose, {
    type: "sale",
    requestedPuzzleId: copy.id,
    salePrice: 1000,
  });

const proposeLend = (t: T, borrower: Name, copy: Copy) =>
  as(t, borrower).mutation(api.exchange.propose.propose, {
    type: "loan",
    requestedPuzzleId: copy.id,
  });

const proposeSwap = (t: T, initiator: Name, requested: Copy, offered: Copy) =>
  as(t, initiator).mutation(api.exchange.propose.propose, {
    type: "trade",
    requestedPuzzleId: requested.id,
    offeredPuzzleId: offered.id,
  });

const accept = (t: T, recipient: Name, exchangeId: string) =>
  as(t, recipient).mutation(api.exchange.accept.accept, { exchangeId });

const confirm = (t: T, party: Name, exchangeId: string) =>
  as(t, party).mutation(api.exchange.confirmCompletion.confirmCompletion, {
    exchangeId,
  });

// Accept, both confirm, run the settlement reactions.
const settle = async (
  t: T,
  exchangeId: string,
  initiator: Name,
  recipient: Name,
) => {
  await accept(t, recipient, exchangeId);
  await confirm(t, initiator, exchangeId);
  await confirm(t, recipient, exchangeId);
  await flush(t);
};

const copyRow = async (t: T, copy: Copy) => {
  const row = await t.run((ctx) => ctx.db.get(copy.id));
  if (!row) throw new Error("copy vanished");
  return row;
};

const statusOf = (t: T, exchangeId: string) =>
  t.run(
    async (ctx) =>
      (
        await ctx.db
          .query("exchanges")
          .withIndex("by_aggregate_id", (q) => q.eq("aggregateId", exchangeId))
          .unique()
      )?.status,
  );

const custodyOf = (t: T, copy: Copy) =>
  t.run((ctx) =>
    ctx.db
      .query("copyCustodyEntries")
      .withIndex("by_copy", (q) => q.eq("copyId", copy.id))
      .collect(),
  );

const loansOf = (t: T, copy: Copy) =>
  t.run((ctx) =>
    ctx.db
      .query("loans")
      .withIndex("by_copy", (q) => q.eq("copyId", copy.aggregateId))
      .collect(),
  );

const codeOf = async (p: Promise<unknown>): Promise<string | undefined> => {
  const error = await p.then(
    () => undefined,
    (e: unknown) => e,
  );
  expect(error).toBeInstanceOf(ConvexError);
  const data = (error as ConvexError<Value>).data;
  return (
    typeof data === "string" ? JSON.parse(data) : (data as { code?: string })
  ).code;
};

// Mara and Hugo share a household (default permission: manage), so Hugo may offer Mara's copies.
const formHousehold = async (t: T, ids: Ids) => {
  await as(t, "mara").mutation(
    api.household.createHousehold.createHousehold,
    {},
  );
  const inviteId = await as(t, "mara").mutation(
    api.household.inviteToHousehold.inviteToHousehold,
    { inviteeId: ids.hugo },
  );
  await as(t, "hugo").mutation(
    api.household.acceptHouseholdInvite.acceptHouseholdInvite,
    { inviteId },
  );
};

const removeHugo = (t: T, ids: Ids) =>
  as(t, "mara").mutation(
    api.household.removeHouseholdMember.removeHouseholdMember,
    { memberId: ids.hugo },
  );

describe("a stale exchange never settles once a copy changed hands", () => {
  test("sockpuppet sale: Bob's old deal can't take the copy back out of Vic's library", async () => {
    const t = convexTest(schema, modules);
    const { ids, puzzleAggregateId } = await seed(t);
    const y = await acquire(t, "bob", puzzleAggregateId);
    await offer(t, "bob", y, { forSale: true });

    // Bob's sockpuppet gets an accepted sale on Y and confirms it, then leaves it open.
    const stale = await proposeSale(t, "sock", y);
    await accept(t, "bob", stale);
    await confirm(t, "sock", stale);

    // Vic buys Y honestly.
    await settle(t, await proposeSale(t, "vic", y), "vic", "bob");
    expect((await copyRow(t, y)).ownerId).toBe(ids.vic);

    // Bob, no longer the owner, confirms the stale deal: refused, nothing moves.
    expect(await codeOf(confirm(t, "bob", stale))).toBe("RecipientNotOwner");
    await flush(t);
    expect((await copyRow(t, y)).ownerId).toBe(ids.vic);
    expect(await statusOf(t, stale)).toBe("accepted");
    expect((await custodyOf(t, y)).map((e) => e.newOwner)).toEqual([ids.vic]);
  });

  test("an exchange proposed to the former owner can no longer be accepted", async () => {
    const t = convexTest(schema, modules);
    const { ids, puzzleAggregateId } = await seed(t);
    const y = await acquire(t, "bob", puzzleAggregateId);
    await offer(t, "bob", y, { forSale: true });

    const stale = await proposeSale(t, "sock", y);
    await settle(t, await proposeSale(t, "vic", y), "vic", "bob");

    expect(await codeOf(accept(t, "bob", stale))).toBe("RecipientNotOwner");
    expect(await statusOf(t, stale)).toBe("proposed");
    expect((await copyRow(t, y)).ownerId).toBe(ids.vic);
  });

  test("lend variant: no loan opens in Vic's name and the borrower never holds Vic's copy", async () => {
    const t = convexTest(schema, modules);
    const { ids, puzzleAggregateId } = await seed(t);
    const y = await acquire(t, "bob", puzzleAggregateId);
    await offer(t, "bob", y, { forSale: true, forLend: true });

    const stale = await proposeLend(t, "sock", y);
    await accept(t, "bob", stale);
    await confirm(t, "sock", stale);
    await settle(t, await proposeSale(t, "vic", y), "vic", "bob");

    expect(await codeOf(confirm(t, "bob", stale))).toBe("RecipientNotOwner");
    await flush(t);
    expect(await loansOf(t, y)).toHaveLength(0);
    const row = await copyRow(t, y);
    expect(row.ownerId).toBe(ids.vic);
    expect(row.heldBy ?? row.ownerId).toBe(ids.vic);
  });
});

describe("a housemate's swap stops once they leave the household", () => {
  const setUp = async () => {
    const t = convexTest(schema, modules);
    const { ids, puzzleAggregateId } = await seed(t);
    await formHousehold(t, ids);
    const x = await acquire(t, "mara", puzzleAggregateId);
    const r = await acquire(t, "rex", puzzleAggregateId);
    await offer(t, "rex", r, { forTrade: true });
    // Hugo offers Mara's copy X for Rex's R.
    const swap = await proposeSwap(t, "hugo", r, x);
    return { t, ids, x, r, swap };
  };

  test("removed before Rex accepts: the accept is refused and X stays Mara's", async () => {
    const { t, ids, x, r, swap } = await setUp();
    await removeHugo(t, ids);

    expect(await codeOf(accept(t, "rex", swap))).toBe("OfferedCopyNotOwned");
    expect(await statusOf(t, swap)).toBe("proposed");
    expect((await copyRow(t, x)).ownerId).toBe(ids.mara);
    expect((await copyRow(t, r)).ownerId).toBe(ids.rex);
  });

  test("removed after Rex accepted: both confirmations are refused and X stays Mara's", async () => {
    const { t, ids, x, r, swap } = await setUp();
    await accept(t, "rex", swap);
    await removeHugo(t, ids);

    expect(await codeOf(confirm(t, "hugo", swap))).toBe("OfferedCopyNotOwned");
    expect(await codeOf(confirm(t, "rex", swap))).toBe("OfferedCopyNotOwned");
    await flush(t);
    expect(await statusOf(t, swap)).toBe("accepted");
    expect((await copyRow(t, x)).ownerId).toBe(ids.mara);
    expect((await copyRow(t, r)).ownerId).toBe(ids.rex);
    expect(await custodyOf(t, x)).toHaveLength(0);
  });
});

describe("deals whose copies are still in place settle as before", () => {
  test("a sale", async () => {
    const t = convexTest(schema, modules);
    const { ids, puzzleAggregateId } = await seed(t);
    const y = await acquire(t, "bob", puzzleAggregateId);
    await offer(t, "bob", y, { forSale: true });

    const sale = await proposeSale(t, "vic", y);
    await settle(t, sale, "vic", "bob");

    expect(await statusOf(t, sale)).toBe("completed");
    expect((await copyRow(t, y)).ownerId).toBe(ids.vic);
  });

  test("a swap of two members' own copies", async () => {
    const t = convexTest(schema, modules);
    const { ids, puzzleAggregateId } = await seed(t);
    const y = await acquire(t, "bob", puzzleAggregateId);
    const s = await acquire(t, "sock", puzzleAggregateId);
    await offer(t, "bob", y, { forTrade: true });

    const swap = await proposeSwap(t, "sock", y, s);
    await settle(t, swap, "sock", "bob");

    expect(await statusOf(t, swap)).toBe("completed");
    expect((await copyRow(t, y)).ownerId).toBe(ids.sock);
    expect((await copyRow(t, s)).ownerId).toBe(ids.bob);
  });

  test("a swap offering a housemate's copy, while still in the household", async () => {
    const t = convexTest(schema, modules);
    const { ids, puzzleAggregateId } = await seed(t);
    await formHousehold(t, ids);
    const x = await acquire(t, "mara", puzzleAggregateId);
    const r = await acquire(t, "rex", puzzleAggregateId);
    await offer(t, "rex", r, { forTrade: true });

    const swap = await proposeSwap(t, "hugo", r, x);
    await settle(t, swap, "hugo", "rex");

    expect(await statusOf(t, swap)).toBe("completed");
    expect((await copyRow(t, x)).ownerId).toBe(ids.rex);
    expect((await copyRow(t, r)).ownerId).toBe(ids.hugo);
  });

  test("a lend", async () => {
    const t = convexTest(schema, modules);
    const { ids, puzzleAggregateId } = await seed(t);
    const y = await acquire(t, "bob", puzzleAggregateId);
    await offer(t, "bob", y, { forLend: true });

    const lend = await proposeLend(t, "sock", y);
    await settle(t, lend, "sock", "bob");

    expect(await statusOf(t, lend)).toBe("completed");
    const row = await copyRow(t, y);
    expect(row.ownerId).toBe(ids.bob);
    expect(row.heldBy).toBe(ids.sock);
    expect(await loansOf(t, y)).toHaveLength(1);
  });
});
