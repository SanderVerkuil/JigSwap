import { convexTest, type TestConvex } from "convex-test";
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import { api, internal } from "./_generated/api";
import type { Doc, Id } from "./_generated/dataModel";
import schema from "./schema";

// The denormalized `ownedPuzzles.isOpen` listing flag (PERF-B1m, SEC-29): every availability write
// keeps it equal to "at least one exchange-availability flag is set", and the one-shot backfill sets
// it on legacy rows and repairs any row whose flag disagrees with its availability.

const modules = import.meta.glob(["./**/*.{js,ts}", "!./**/*.test.{js,ts}"]);

type Avail = Doc<"ownedPuzzles">["availability"];
const CLOSED: Avail = { forTrade: false, forSale: false, forLend: false };
const NOW = 1_700_000_000_000;

const seedMembers = (t: TestConvex<typeof schema>) =>
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
    const puzzleAggregateId = crypto.randomUUID();
    const puzzleId = await ctx.db.insert("puzzles", {
      aggregateId: puzzleAggregateId,
      title: "Mountain Vista",
      pieceCount: 1000,
      status: "approved",
      submittedBy: alice,
      createdAt: NOW,
      updatedAt: NOW,
    });
    return { alice, bob, puzzleId, puzzleAggregateId };
  });

const asAlice = (t: TestConvex<typeof schema>) =>
  t.withIdentity({ subject: "clerk_alice" });
const asBob = (t: TestConvex<typeof schema>) =>
  t.withIdentity({ subject: "clerk_bob" });

const rowByAggregate = (t: TestConvex<typeof schema>, aggregateId: string) =>
  t.run(async (ctx) =>
    ctx.db
      .query("ownedPuzzles")
      .withIndex("by_aggregate_id", (q) => q.eq("aggregateId", aggregateId))
      .unique(),
  );

describe("the copy repository keeps isOpen in step with availability", () => {
  test("a newly acquired copy is stored closed", async () => {
    const t = convexTest(schema, modules);
    const { puzzleAggregateId } = await seedMembers(t);
    const copyId = await asAlice(t).mutation(
      api.library.acquireCopy.acquireCopy,
      { puzzleDefinitionId: puzzleAggregateId, condition: "good" },
    );
    expect((await rowByAggregate(t, copyId))?.isOpen).toBe(false);
  });

  test("a batch item offered for swap is stored open", async () => {
    const t = convexTest(schema, modules);
    const { puzzleAggregateId } = await seedMembers(t);
    const { copyIds } = await asAlice(t).mutation(
      api.library.acquireCopies.acquireCopies,
      { items: [{ puzzleDefinitionId: puzzleAggregateId, forTrade: true }] },
    );
    expect((await rowByAggregate(t, copyIds[0]!))?.isOpen).toBe(true);
  });

  test("opening and closing a copy's sharing flips the flag both ways", async () => {
    const t = convexTest(schema, modules);
    const { puzzleAggregateId } = await seedMembers(t);
    const copyId = await asAlice(t).mutation(
      api.library.acquireCopy.acquireCopy,
      { puzzleDefinitionId: puzzleAggregateId, condition: "good" },
    );
    const share = (flags: Partial<Avail>) =>
      asAlice(t).mutation(api.library.updateCopySharing.updateCopySharing, {
        copyId,
        visibility: "visible",
        ...flags,
      });

    await share({ forLend: true });
    expect((await rowByAggregate(t, copyId))?.isOpen).toBe(true);
    await share({ forLend: false });
    expect((await rowByAggregate(t, copyId))?.isOpen).toBe(false);
  });

  test("a settled exchange takes the copy off the market and clears the flag", async () => {
    const t = convexTest(schema, modules);
    const { bob, puzzleId } = await seedMembers(t);
    const copy = await t.run((ctx) =>
      ctx.db.insert("ownedPuzzles", {
        puzzleId,
        ownerId: bob,
        condition: "good",
        availability: { ...CLOSED, forSale: true },
        isOpen: true,
        createdAt: NOW,
        updatedAt: NOW,
      }),
    );
    const exchangeId = await asAlice(t).mutation(api.exchange.propose.propose, {
      recipientId: bob,
      type: "sale",
      requestedPuzzleId: copy,
      salePrice: 1000,
    });
    await asBob(t).mutation(api.exchange.accept.accept, { exchangeId });
    await asAlice(t).mutation(
      api.exchange.confirmCompletion.confirmCompletion,
      { exchangeId },
    );
    await asBob(t).mutation(api.exchange.confirmCompletion.confirmCompletion, {
      exchangeId,
    });
    const row = await t.run((ctx) => ctx.db.get(copy));
    expect(row?.availability).toEqual(CLOSED);
    expect(row?.isOpen).toBe(false);
  });
});

describe("library.backfillCopyOpenFlag", () => {
  beforeEach(() => {
    vi.spyOn(console, "log").mockImplementation(() => {});
  });
  afterEach(() => {
    vi.restoreAllMocks();
  });

  const backfill = internal.library.backfillCopyOpenFlag.backfillCopyOpenFlag;

  const seedRows = (
    t: TestConvex<typeof schema>,
    rows: { availability: Avail; isOpen?: boolean }[],
  ) =>
    t.run(async (ctx) => {
      const owner = await ctx.db.insert("users", {
        clerkId: "clerk_owner",
        email: "owner@example.com",
        name: "owner",
        isActive: true,
        createdAt: NOW,
        updatedAt: NOW,
      });
      const puzzleId = await ctx.db.insert("puzzles", {
        title: "P",
        pieceCount: 500,
        status: "approved",
        submittedBy: owner,
        createdAt: NOW,
        updatedAt: NOW,
      });
      const ids: Id<"ownedPuzzles">[] = [];
      for (const extra of rows) {
        ids.push(
          await ctx.db.insert("ownedPuzzles", {
            puzzleId,
            ownerId: owner,
            condition: "good",
            createdAt: NOW,
            updatedAt: NOW,
            ...extra,
          }),
        );
      }
      return ids;
    });

  const rowsOf = (t: TestConvex<typeof schema>, ids: Id<"ownedPuzzles">[]) =>
    t.run(async (ctx) => Promise.all(ids.map((id) => ctx.db.get(id))));

  // Run the first batch, then drain the self-rescheduled ones.
  const runAll = async (
    t: TestConvex<typeof schema>,
    args: { dryRun?: boolean; batchSize?: number } = {},
  ) => {
    vi.useFakeTimers();
    try {
      const first = await t.mutation(backfill, args);
      await t.finishAllScheduledFunctions(vi.runAllTimers);
      return first;
    } finally {
      vi.useRealTimers();
    }
  };

  // Totals of the whole run, from the last batch's log line.
  const lastTotals = () => {
    const calls = vi.mocked(console.log).mock.calls;
    const line = JSON.parse(String(calls[calls.length - 1]![0])) as {
      totals: Record<string, number>;
      is_done: boolean;
    };
    expect(line.is_done).toBe(true);
    return line.totals;
  };

  const MIXED = [
    { availability: { ...CLOSED, forTrade: true } }, // legacy open
    { availability: CLOSED }, // legacy closed
    { availability: { ...CLOSED, forSale: true }, isOpen: false }, // drifted: open, flagged closed
    { availability: CLOSED, isOpen: true }, // drifted: closed, flagged open
    { availability: { ...CLOSED, forLend: true }, isOpen: true }, // in step
    { availability: CLOSED, isOpen: false }, // in step
  ];

  test("a dry run counts what it would write and writes nothing", async () => {
    const t = convexTest(schema, modules);
    const ids = await seedRows(t, MIXED);
    const before = await rowsOf(t, ids);

    const first = await runAll(t, { dryRun: true });
    expect(first).toEqual({ scanned: 6, set: 2, repaired: 2, inStep: 2 });
    expect(await rowsOf(t, ids)).toEqual(before);
  });

  test("sets the flag on legacy rows, repairs drifted rows and leaves the rest alone", async () => {
    const t = convexTest(schema, modules);
    const ids = await seedRows(t, MIXED);
    const before = await rowsOf(t, ids);

    await runAll(t);
    const after = await rowsOf(t, ids);
    expect(after.map((row) => row?.isOpen)).toEqual([
      true,
      false,
      true,
      false,
      true,
      false,
    ]);
    // Only the flag changes: availability and updatedAt are not an owner edit.
    after.forEach((row, i) => {
      const { isOpen: _after, ...rest } = row!;
      const { isOpen: _before, ...restBefore } = before[i]!;
      expect(rest).toEqual(restBefore);
    });
  });

  test("pages through the table in batches and carries the totals", async () => {
    const t = convexTest(schema, modules);
    await seedRows(t, MIXED);

    const first = await runAll(t, { batchSize: 2 });
    expect(first.scanned).toBe(2);
    expect(lastTotals()).toEqual({
      scanned: 6,
      set: 2,
      repaired: 2,
      inStep: 2,
    });
  });

  test("a second run writes nothing", async () => {
    const t = convexTest(schema, modules);
    const ids = await seedRows(t, MIXED);
    await runAll(t);
    const once = await rowsOf(t, ids);

    await runAll(t);
    expect(lastTotals()).toEqual({
      scanned: 6,
      set: 0,
      repaired: 0,
      inStep: 6,
    });
    expect(await rowsOf(t, ids)).toEqual(once);
  });
});
