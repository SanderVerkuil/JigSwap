import { convexTest, type TestConvex } from "convex-test";
import { describe, expect, test } from "vitest";
import { drainBatches } from "../test-fixtures/cursorBatches";
import { internal } from "./_generated/api";
import type { Id } from "./_generated/dataModel";
import schema from "./schema";

// Bundle every Convex module for the in-memory runtime, excluding test files.
const modules = import.meta.glob(["./**/*.{js,ts}", "!./**/*.test.{js,ts}"]);

// Seed a bare puzzles row (legacy-style write, no aggregate) with the given brand/publisher.
const seedPuzzle = (
  t: TestConvex<typeof schema>,
  fields: { title: string; brand?: string; publisher?: string },
) =>
  t.run(async (ctx) => {
    const now = Date.now();
    const submittedBy = await ctx.db.insert("users", {
      clerkId: `clerk_${fields.title}`,
      email: `${fields.title}@example.com`,
      name: fields.title,
      isActive: true,
      createdAt: now,
      updatedAt: now,
    });
    return ctx.db.insert("puzzles", {
      title: fields.title,
      brand: fields.brand,
      publisher: fields.publisher,
      pieceCount: 1000,
      searchableText: [fields.title, fields.brand].filter(Boolean).join(" "),
      status: "approved",
      submittedBy,
      createdAt: now,
      updatedAt: now,
    });
  });

// The migration paged to the end, as an operator runs it: every page's changes, and the moves.
const migrate = async (
  t: TestConvex<typeof schema>,
  args: { dryRun?: boolean; batchSize?: number } = {},
) => {
  const batches = await drainBatches((cursor) =>
    t.mutation(internal.catalog.migratePublishers.run, { ...args, cursor }),
  );
  return {
    batches: batches.length,
    dryRun: batches.every((batch) => batch.dryRun),
    moved: batches.reduce((sum, batch) => sum + batch.moved, 0),
    changes: batches.flatMap((batch) => batch.changes),
  };
};

describe("catalog.migratePublishers", () => {
  test("dry run reports moves without writing", async () => {
    const t = convexTest(schema, modules);
    const id = await seedPuzzle(t, { title: "Alpine", brand: "ravensburger" });
    const report = await migrate(t);
    expect(report.dryRun).toBe(true);
    expect(report.moved).toBe(1);
    expect(report.changes[0]).toEqual({
      title: "Alpine",
      from: "ravensburger",
      to: "Ravensburger",
    });
    const row = await t.run(async (ctx) => ctx.db.get(id));
    expect(row?.brand).toBe("ravensburger"); // untouched: dryRun defaults to true
    expect(row?.publisher).toBeUndefined();
  });

  test("real run moves known publishers, clears brand, recomputes searchableText", async () => {
    const t = convexTest(schema, modules);
    const moved = await seedPuzzle(t, {
      title: "Alpine",
      brand: "ravensburger",
    });
    const line = await seedPuzzle(t, {
      title: "Roadworks",
      brand: "Jan van Haasteren",
    });
    const already = await seedPuzzle(t, {
      title: "Ocean",
      brand: "Jumbo",
      publisher: "Jumbo",
    });

    const report = await migrate(t, { dryRun: false });
    expect(report.moved).toBe(1);

    const movedRow = await t.run(async (ctx) => ctx.db.get(moved));
    expect(movedRow?.publisher).toBe("Ravensburger");
    expect(movedRow?.brand).toBeUndefined();
    expect(movedRow?.searchableText).toContain("Ravensburger");
    expect(movedRow?.searchableText).toContain("Alpine");

    const lineRow = await t.run(async (ctx) => ctx.db.get(line));
    expect(lineRow?.brand).toBe("Jan van Haasteren"); // not a publisher: untouched

    const alreadyRow = await t.run(async (ctx) => ctx.db.get(already));
    expect(alreadyRow?.brand).toBe("Jumbo"); // has publisher already: skipped (idempotent)
  });

  test("small batches take several calls; the dry run reports every page's moves", async () => {
    const t = convexTest(schema, modules);
    const brands = ["ravensburger", "Jumbo", "Wasgij", "clementoni", "Jumbo"];
    const ids: Id<"puzzles">[] = [];
    for (const [i, brand] of brands.entries()) {
      ids.push(await seedPuzzle(t, { title: `Puzzle ${i}`, brand }));
    }

    const dry = await migrate(t, { batchSize: 2 });
    expect(dry.batches).toBeGreaterThanOrEqual(3);
    expect(dry.changes.map((change) => change.title)).toEqual([
      "Puzzle 0",
      "Puzzle 1",
      "Puzzle 3",
      "Puzzle 4",
    ]);

    const real = await migrate(t, { dryRun: false, batchSize: 2 });
    expect(real.moved).toBe(4);
    const rows = await t.run((ctx) =>
      Promise.all(ids.map((id) => ctx.db.get(id))),
    );
    expect(
      rows.map((row) => [row?.brand ?? null, row?.publisher ?? null]),
    ).toEqual([
      [null, "Ravensburger"],
      [null, "Jumbo"],
      ["Wasgij", null],
      [null, "Clementoni"],
      [null, "Jumbo"],
    ]);

    // Idempotent: a second real run moves nothing.
    expect((await migrate(t, { dryRun: false, batchSize: 2 })).moved).toBe(0);
  });
});
