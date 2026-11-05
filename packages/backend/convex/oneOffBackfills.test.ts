import { convexTest, type TestConvex } from "convex-test";
import { describe, expect, test } from "vitest";
import { drainBatches } from "../test-fixtures/cursorBatches";
import { internal } from "./_generated/api";
import type { Id } from "./_generated/dataModel";
import schema from "./schema";

// The one-off backfills page their table in cursor batches, one transaction per batch, instead of
// reading the whole table in one mutation (PERF-B16): solving/backfillCompletionPuzzleId,
// library/backfill, exchange/backfill and solving/backfill. (notifications/backfill,
// reputation/backfill and catalog/migratePublishers are covered next to their other tests.)
// A batchSize smaller than the table takes several calls and ends with the same rows patched as a
// single whole-table pass did; a second run patches nothing.

const modules = import.meta.glob(["./**/*.{js,ts}", "!./**/*.test.{js,ts}"]);
type T = TestConvex<typeof schema>;

const ROWS = 5;
const BATCH = 2;
// Calls needed for ROWS rows at BATCH per call.
const MIN_BATCHES = Math.ceil(ROWS / BATCH);

const totalPatched = (batches: { patched: number }[]) =>
  batches.reduce((sum, batch) => sum + batch.patched, 0);

// A member and a puzzle with no aggregateId (legacy), for the rows below to reference.
const seed = (t: T) =>
  t.run(async (ctx) => {
    const now = Date.now();
    const alice = await ctx.db.insert("users", {
      clerkId: "clerk_alice",
      email: "alice@example.com",
      name: "Alice",
      isActive: true,
      createdAt: now,
      updatedAt: now,
    });
    const bob = await ctx.db.insert("users", {
      clerkId: "clerk_bob",
      email: "bob@example.com",
      name: "Bob",
      isActive: true,
      createdAt: now,
      updatedAt: now,
    });
    const puzzleId = await ctx.db.insert("puzzles", {
      title: "Mountain Vista",
      brand: "Ravensburger",
      pieceCount: 1000,
      status: "approved",
      submittedBy: alice,
      createdAt: now,
      updatedAt: now,
    });
    return { alice, bob, puzzleId };
  });

// A legacy copy: no aggregateId, no puzzleDefinitionId, no snapshot.
const insertLegacyCopy = (
  t: T,
  ownerId: Id<"users">,
  puzzleId: Id<"puzzles">,
) =>
  t.run((ctx) =>
    ctx.db.insert("ownedPuzzles", {
      puzzleId,
      ownerId,
      condition: "good",
      availability: { forTrade: false, forSale: false, forLend: false },
      createdAt: Date.now(),
      updatedAt: Date.now(),
    }),
  );

describe("solving/backfillCompletionPuzzleId", () => {
  test("small batches take several calls and anchor every linked completion", async () => {
    const t = convexTest(schema, modules);
    const { alice, puzzleId } = await seed(t);
    const copy = await insertLegacyCopy(t, alice, puzzleId);
    const ids: Id<"completions">[] = [];
    for (let i = 0; i < ROWS; i++) {
      ids.push(
        await t.run((ctx) =>
          ctx.db.insert("completions", {
            userId: alice,
            // One of them has no copy link: nothing to derive, left alone.
            ownedPuzzleId: i === 0 ? undefined : copy,
            startDate: Date.now(),
            photos: [],
            isCompleted: true,
            createdAt: Date.now(),
            updatedAt: Date.now(),
          }),
        ),
      );
    }

    const run = () =>
      drainBatches((cursor) =>
        t.mutation(internal.solving.backfillCompletionPuzzleId.run, {
          cursor,
          batchSize: BATCH,
        }),
      );
    const batches = await run();
    expect(batches.length).toBeGreaterThanOrEqual(MIN_BATCHES);
    expect(totalPatched(batches)).toBe(ROWS - 1);
    const rows = await t.run((ctx) =>
      Promise.all(ids.map((id) => ctx.db.get(id))),
    );
    expect(rows.map((row) => row?.puzzleId ?? null)).toEqual([
      null,
      puzzleId,
      puzzleId,
      puzzleId,
      puzzleId,
    ]);

    expect(totalPatched(await run())).toBe(0);
  });
});

describe("library/backfill", () => {
  const run = (t: T, table: "ownedPuzzles" | "collections" | "categories") =>
    drainBatches((cursor) =>
      t.mutation(internal.library.backfill.backfillLibrary, {
        table,
        cursor,
        batchSize: BATCH,
      }),
    );

  test("ownedPuzzles: small batches stamp every copy and derive its snapshot from the puzzle", async () => {
    const t = convexTest(schema, modules);
    const { alice, puzzleId } = await seed(t);
    const ids: Id<"ownedPuzzles">[] = [];
    for (let i = 0; i < ROWS; i++) {
      ids.push(await insertLegacyCopy(t, alice, puzzleId));
    }

    const batches = await run(t, "ownedPuzzles");
    expect(batches.length).toBeGreaterThanOrEqual(MIN_BATCHES);
    expect(totalPatched(batches)).toBe(ROWS);
    expect(
      batches.reduce((sum, batch) => sum + batch.snapshotsPopulated, 0),
    ).toBe(ROWS);
    // The shared puzzle is stamped once, by the first copy that needed it.
    expect(batches.reduce((sum, batch) => sum + batch.puzzlesStamped, 0)).toBe(
      1,
    );

    const { puzzle, copies } = await t.run(async (ctx) => ({
      puzzle: await ctx.db.get(puzzleId),
      copies: await Promise.all(ids.map((id) => ctx.db.get(id))),
    }));
    expect(puzzle?.aggregateId).toBeDefined();
    for (const copy of copies) {
      expect(copy?.aggregateId).toBeDefined();
      expect(copy?.puzzleDefinitionId).toBe(puzzle?.aggregateId);
      expect(copy?.snapshot).toEqual({
        title: "Mountain Vista",
        brand: "Ravensburger",
        pieceCount: 1000,
      });
    }

    expect(totalPatched(await run(t, "ownedPuzzles"))).toBe(0);
  });

  test("collections and categories: small batches stamp every row", async () => {
    const t = convexTest(schema, modules);
    const { alice } = await seed(t);
    await t.run(async (ctx) => {
      for (let i = 0; i < ROWS; i++) {
        await ctx.db.insert("collections", {
          userId: alice,
          name: `Collection ${i}`,
          visibility: "private",
          isDefault: false,
          createdAt: Date.now(),
          updatedAt: Date.now(),
        });
        await ctx.db.insert("categories", {
          userId: alice,
          name: `Category ${i}`,
          isDefault: false,
          createdAt: Date.now(),
          updatedAt: Date.now(),
        });
      }
    });

    for (const table of ["collections", "categories"] as const) {
      const batches = await run(t, table);
      expect(batches.length).toBeGreaterThanOrEqual(MIN_BATCHES);
      expect(totalPatched(batches)).toBe(ROWS);
      expect(totalPatched(await run(t, table))).toBe(0);
    }
    const unstamped = await t.run(async (ctx) => [
      ...(await ctx.db.query("collections").collect()),
      ...(await ctx.db.query("categories").collect()),
    ]);
    expect(unstamped.filter((row) => row.aggregateId === undefined)).toEqual(
      [],
    );
  });
});

describe("exchange/backfill", () => {
  test("small batches take several calls and stamp every exchange", async () => {
    const t = convexTest(schema, modules);
    const { alice, bob, puzzleId } = await seed(t);
    const copy = await insertLegacyCopy(t, bob, puzzleId);
    await t.run(async (ctx) => {
      for (let i = 0; i < ROWS; i++) {
        await ctx.db.insert("exchanges", {
          // One already carries its id: skipped, not overwritten.
          aggregateId: i === 0 ? "kept" : undefined,
          initiatorId: alice,
          recipientId: bob,
          type: "trade",
          requestedPuzzleId: copy,
          status: "proposed",
          createdAt: Date.now(),
          updatedAt: Date.now(),
        });
      }
    });

    const run = () =>
      drainBatches((cursor) =>
        t.mutation(internal.exchange.backfill.backfillAggregateIds, {
          cursor,
          batchSize: BATCH,
        }),
      );
    const batches = await run();
    expect(batches.length).toBeGreaterThanOrEqual(MIN_BATCHES);
    expect(totalPatched(batches)).toBe(ROWS - 1);
    const ids = await t.run(async (ctx) =>
      (await ctx.db.query("exchanges").collect()).map((row) => row.aggregateId),
    );
    expect(ids[0]).toBe("kept");
    expect(ids.every((id) => id !== undefined)).toBe(true);

    expect(totalPatched(await run())).toBe(0);
  });
});

describe("solving/backfill", () => {
  test("completions and goals: small batches stamp every row", async () => {
    const t = convexTest(schema, modules);
    const { alice } = await seed(t);
    await t.run(async (ctx) => {
      for (let i = 0; i < ROWS; i++) {
        await ctx.db.insert("completions", {
          userId: alice,
          startDate: Date.now(),
          photos: [],
          isCompleted: true,
          createdAt: Date.now(),
          updatedAt: Date.now(),
        });
        await ctx.db.insert("goals", {
          userId: alice,
          title: `Goal ${i}`,
          targetCompletions: 10,
          currentCompletions: 0,
          isActive: true,
          createdAt: Date.now(),
          updatedAt: Date.now(),
        });
      }
    });

    const run = (table: "completions" | "goals") =>
      drainBatches((cursor) =>
        t.mutation(internal.solving.backfill.backfillSolving, {
          table,
          cursor,
          batchSize: BATCH,
        }),
      );
    for (const table of ["completions", "goals"] as const) {
      const batches = await run(table);
      expect(batches.length).toBeGreaterThanOrEqual(MIN_BATCHES);
      expect(totalPatched(batches)).toBe(ROWS);
      expect(totalPatched(await run(table))).toBe(0);
    }
    const unstamped = await t.run(async (ctx) => [
      ...(await ctx.db.query("completions").collect()),
      ...(await ctx.db.query("goals").collect()),
    ]);
    expect(unstamped.filter((row) => row.aggregateId === undefined)).toEqual(
      [],
    );
  });
});
