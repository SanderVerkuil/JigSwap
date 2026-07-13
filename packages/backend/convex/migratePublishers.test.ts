import { convexTest } from "convex-test";
import { describe, expect, test } from "vitest";
import { internal } from "./_generated/api";
import schema from "./schema";

// Bundle every Convex module for the in-memory runtime, excluding test files.
const modules = import.meta.glob(["./**/*.{js,ts}", "!./**/*.test.{js,ts}"]);

// Seed a bare puzzles row (legacy-style write, no aggregate) with the given brand/publisher.
const seedPuzzle = (
  t: ReturnType<typeof convexTest>,
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

describe("catalog.migratePublishers", () => {
  test("dry run reports moves without writing", async () => {
    const t = convexTest(schema, modules);
    const id = await seedPuzzle(t, { title: "Alpine", brand: "ravensburger" });
    const report = await t.mutation(internal.catalog.migratePublishers.run, {});
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

    const report = await t.mutation(internal.catalog.migratePublishers.run, {
      dryRun: false,
    });
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
});
