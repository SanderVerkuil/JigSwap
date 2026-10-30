import { convexTest, type TestConvex } from "convex-test";
import { describe, expect, test } from "vitest";
import { api } from "./_generated/api";
import type { Id } from "./_generated/dataModel";
import { EXCHANGE_LIST_CAP } from "./exchange/readViews";
import schema from "./schema";

// Bundle every Convex module for the in-memory runtime, excluding test files.
const modules = import.meta.glob(["./**/*.{js,ts}", "!./**/*.test.{js,ts}"]);

const BASE = 1_700_000_000_000;

// Alice and Bob, each owning one copy the other can ask to borrow.
const seedParties = (t: TestConvex<typeof schema>) =>
  t.run(async (ctx) => {
    const mkUser = (clerkId: string) =>
      ctx.db.insert("users", {
        clerkId,
        email: `${clerkId}@example.com`,
        name: clerkId,
        isActive: true,
        createdAt: BASE,
        updatedAt: BASE,
      });
    const alice = await mkUser("clerk_alice");
    const bob = await mkUser("clerk_bob");
    const puzzle = await ctx.db.insert("puzzles", {
      title: "Harbour Lights",
      pieceCount: 1000,
      status: "approved",
      submittedBy: alice,
      createdAt: BASE,
      updatedAt: BASE,
    });
    const mkCopy = (ownerId: Id<"users">) =>
      ctx.db.insert("ownedPuzzles", {
        puzzleId: puzzle,
        ownerId,
        condition: "good",
        availability: { forTrade: false, forSale: false, forLend: true },
        createdAt: BASE,
        updatedAt: BASE,
      });
    const alicesCopy = await mkCopy(alice);
    const bobsCopy = await mkCopy(bob);
    return { alice, bob, alicesCopy, bobsCopy };
  });

type Parties = Awaited<ReturnType<typeof seedParties>>;

// A loan request; `asInitiator` says whether Alice asked (requester) or was asked (owner).
const insertLoan = (
  t: TestConvex<typeof schema>,
  p: Parties,
  rows: { aggregateId: string; createdAt: number; asInitiator: boolean }[],
) =>
  t.run(async (ctx) => {
    for (const row of rows) {
      await ctx.db.insert("exchanges", {
        aggregateId: row.aggregateId,
        initiatorId: row.asInitiator ? p.alice : p.bob,
        recipientId: row.asInitiator ? p.bob : p.alice,
        type: "loan",
        requestedPuzzleId: row.asInitiator ? p.bobsCopy : p.alicesCopy,
        status: "proposed",
        createdAt: row.createdAt,
        updatedAt: row.createdAt,
      });
    }
  });

const asAlice = (t: TestConvex<typeof schema>) =>
  t.withIdentity({ subject: "clerk_alice" });

describe("exchange.getUserExchanges is bounded (PERF-B13)", () => {
  test("keeps the newest EXCHANGE_LIST_CAP by createdAt, not by insertion order", async () => {
    const t = convexTest(schema, modules);
    const parties = await seedParties(t);
    // Inserted newest-first, so creation order is the reverse of createdAt order: only a read
    // ordered by createdAt keeps the right rows.
    const rows = Array.from({ length: EXCHANGE_LIST_CAP + 1 }, (_, i) => ({
      aggregateId: `exch-${i}`,
      createdAt: BASE - i,
      asInitiator: true,
    }));
    await insertLoan(t, parties, rows);

    const list = await asAlice(t).query(
      api.exchange.getUserExchanges.getUserExchanges,
      {},
    );

    expect(list).toHaveLength(EXCHANGE_LIST_CAP);
    expect(list.map((e) => e.aggregateId)).toEqual(
      rows.slice(0, EXCHANGE_LIST_CAP).map((r) => r.aggregateId),
    );
  });

  test("the cap spans both roles: the newest overall survive, roles still tagged", async () => {
    const t = convexTest(schema, modules);
    const parties = await seedParties(t);
    const perRole = 300;
    // Interleaved: Alice asked at even offsets, was asked at odd offsets.
    const rows = Array.from({ length: perRole * 2 }, (_, i) => ({
      aggregateId: `exch-${i}`,
      createdAt: BASE + i,
      asInitiator: i % 2 === 0,
    }));
    await insertLoan(t, parties, rows);

    const list = await asAlice(t).query(
      api.exchange.getUserExchanges.getUserExchanges,
      {},
    );

    const newest = [...rows]
      .sort((a, b) => b.createdAt - a.createdAt)
      .slice(0, EXCHANGE_LIST_CAP);
    expect(list.map((e) => e.aggregateId)).toEqual(
      newest.map((r) => r.aggregateId),
    );
    expect(list.map((e) => e.userRole)).toEqual(
      newest.map((r) => (r.asInitiator ? "requester" : "owner")),
    );
  });
});

describe("exchange.getExchangesByOwner / getExchangesByRequester are bounded (PERF-B13)", () => {
  // Inserted newest-first, as above, so only a createdAt-ordered read keeps the right rows.
  const rowsFor = (asInitiator: boolean) =>
    Array.from({ length: EXCHANGE_LIST_CAP + 1 }, (_, i) => ({
      aggregateId: `exch-${i}`,
      createdAt: BASE - i,
      asInitiator,
    }));

  test("outgoing keeps the newest EXCHANGE_LIST_CAP", async () => {
    const t = convexTest(schema, modules);
    const rows = rowsFor(true);
    await insertLoan(t, await seedParties(t), rows);

    const outgoing = await asAlice(t).query(
      api.exchange.getExchangesByRequester.getExchangesByRequester,
      {},
    );

    expect(outgoing.map((e) => e.aggregateId)).toEqual(
      rows.slice(0, EXCHANGE_LIST_CAP).map((r) => r.aggregateId),
    );
  });

  test("incoming keeps the newest EXCHANGE_LIST_CAP", async () => {
    const t = convexTest(schema, modules);
    const rows = rowsFor(false);
    await insertLoan(t, await seedParties(t), rows);

    const incoming = await asAlice(t).query(
      api.exchange.getExchangesByOwner.getExchangesByOwner,
      {},
    );

    expect(incoming.map((e) => e.aggregateId)).toEqual(
      rows.slice(0, EXCHANGE_LIST_CAP).map((r) => r.aggregateId),
    );
  });
});
